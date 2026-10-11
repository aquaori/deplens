import { ChatOpenAI } from "@langchain/openai";
import {
	AgentProjectConfig,
	AnalysisReport,
	DependencyContextBundle,
	DependencyReviewCandidate,
	DependencyOverview,
	EvidenceGap,
	ProjectKnowledgeHit,
	ReviewEvidenceRecord,
	ReviewInvestigationActionDraft,
	ReviewInvestigationActionName,
	ReviewVerdictDraft,
	ReviewDecisionMetadata,
	DependencyReviewDisposition,
} from "../types";
import { getDependencyContextBundle } from "../query";
import { toCandidateParseStatus } from "./draft-parser";
import { createLlmDecisionProvider, type ReviewDecisionProvider } from "./review-decisions";
import { appendAgentMemory, findRelevantMemory } from "./memory";
import { fuseReviewConfidence } from "./confidence-fusion";
import { buildInvestigationActionPrompt, buildVerdictDraftPrompt } from "./model-prompts";
import { searchProjectKnowledge } from "./project-knowledge";
import { appendRunSummary } from "./telemetry";
import { collectReviewCoverage } from "./review-coverage";

export interface ReviewWorkflowResult {
	candidate: DependencyReviewCandidate;
	overview: DependencyOverview;
	contextBundle: DependencyContextBundle;
	memoryUsed: boolean;
}

export type ReviewStatusListener = (status: string | null) => void;

export interface ReviewWorkflowOptions {
	memoryEnabled: boolean;
	memoryMaxEntries: number;
	review: AgentProjectConfig["review"];
	telemetry: AgentProjectConfig["telemetry"];
}

function getProjectRoot(report: AnalysisReport): string {
	return report.kind === "project" ? report.path : report.projectPath;
}

function summarizeDeclaration(candidate: DependencyReviewCandidate): ReviewEvidenceRecord[] {
	return candidate.declarations.map((item) => ({
		id: item.id,
		kind: "fact" as const,
		sourceType: "declaration" as const,
		summary: `Declared in ${item.manifestPath} under ${item.section} with version ${item.versionRange}.`,
		filePath: item.manifestPath,
	}));
}

function summarizeReferences(candidate: DependencyReviewCandidate): ReviewEvidenceRecord[] {
	return candidate.references.map((item) => ({
		id: item.id,
		kind: "fact" as const,
		sourceType: "reference" as const,
		summary: `${item.kind} reference in ${item.filePath}:${item.line}.`,
		filePath: item.filePath,
		line: item.line,
	}));
}

function summarizeIssues(candidate: DependencyReviewCandidate): ReviewEvidenceRecord[] {
	return candidate.issues.map((item) => ({
		id: item.id,
		kind: "fact" as const,
		sourceType: "issue" as const,
		summary: `${item.issueType}: ${item.reason}`,
		evidenceIds: item.supportingEvidenceIds,
	}));
}

function summarizeSignals(
	candidate: DependencyReviewCandidate,
	filter?: (item: DependencyReviewCandidate["signals"][number]) => boolean
): ReviewEvidenceRecord[] {
	return candidate.signals
		.filter((item) => !filter || filter(item))
		.map((item) => ({
			id: item.id,
			kind: "fact" as const,
			sourceType: "signal" as const,
			summary: `${item.signalType} in ${item.filePath}:${item.line} [${item.fileRole}] => ${item.value}`,
			filePath: item.filePath,
			line: item.line,
		}));
}

function summarizeContext(
	contextBundle: DependencyContextBundle,
	filter?: (item: DependencyContextBundle["snippets"][number]) => boolean
): ReviewEvidenceRecord[] {
	return contextBundle.snippets
		.filter((item) => !filter || filter(item))
		.map((item) => ({
			id: `context:${item.filePath}:${item.focusLine}:${item.origin}`,
			kind: "fact" as const,
			sourceType: "context" as const,
			summary: `${item.summary} [${item.fileRole}] at ${item.filePath}:${item.focusLine}`,
			content: item.code,
			filePath: item.filePath,
			line: item.focusLine,
		}));
}

function summarizeKnowledgeHits(hits: ProjectKnowledgeHit[]): ReviewEvidenceRecord[] {
	return hits.map((hit) => {
		const ageDays = Math.max(0, Date.now() - new Date(hit.chunk.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
		const freshnessScore = Math.max(0.1, Math.min(1, 1 - (ageDays / 365)));
		return {
			id: hit.chunk.id,
			kind: "claim" as const,
			sourceType: "knowledge" as const,
			summary: `${hit.chunk.filePath}: ${hit.chunk.text.replace(/\s+/g, " ").slice(0, 220)}`,
			filePath: hit.chunk.filePath,
			freshnessScore,
		};
	});
}

/**
 * 历史评审记录只作为「参考提示」进入证据台账，不作为可引用的支持证据。
 * 它记录的是 agent 自己过去的判断，一旦参与置信度计算就会形成自我印证。
 */
function summarizeMemoryHits(
	hits: ReturnType<typeof findRelevantMemory>
): ReviewEvidenceRecord[] {
	return hits.map((hit, index) => ({
		id: `memory:${index + 1}:${hit.entry.id}`,
		kind: "claim" as const,
		sourceType: "memory" as const,
		summary: `Past review (reference only, not evidence): ${hit.entry.dependencyName || "-"} => ${hit.entry.disposition || "-"} (${hit.entry.confidence || "-"})`,
		freshnessScore: Math.max(0.1, Math.min(1, hit.score / 20)),
	}));
}

function seedEvidenceLedger(
	candidate: DependencyReviewCandidate
): Map<string, ReviewEvidenceRecord> {
	const ledger = new Map<string, ReviewEvidenceRecord>();
	for (const item of [
		...summarizeDeclaration(candidate),
		...summarizeReferences(candidate),
		...summarizeIssues(candidate),
	]) {
		ledger.set(item.id, item);
	}
	return ledger;
}

function buildEvidenceGaps(
	candidate: DependencyReviewCandidate
): EvidenceGap[] {
	const gaps: EvidenceGap[] = [];
	if (candidate.signals.some((item) => item.fileRole === "script" || item.signalType === "script-command")) {
		gaps.push({
			id: "gap:scripts",
			action: "inspect_scripts",
			description: "Script and startup command usage has not been inspected yet.",
			resolved: false,
		});
	}
	if (candidate.signals.some((item) => item.fileRole === "config" || item.fileRole === "tooling")) {
		gaps.push({
			id: "gap:config",
			action: "inspect_config",
			description: "Config or tooling file evidence has not been inspected yet.",
			resolved: false,
		});
	}
	if (candidate.signalCount > 0 || candidate.references.length > 0) {
		gaps.push({
			id: "gap:context",
			action: "inspect_code_context",
			description: "Relevant code snippets have not been checked yet.",
			resolved: false,
		});
	}
	gaps.push({
		id: "gap:knowledge",
		action: "search_project_knowledge",
		description: "Project rules, README notes, and prior reviews have not been checked yet.",
		resolved: false,
	});
	return gaps;
}

function getAllowedActions(gaps: EvidenceGap[], history: ReviewInvestigationActionDraft[], candidate: DependencyReviewCandidate, ledger: Map<string, ReviewEvidenceRecord>): ReviewInvestigationActionName[] {
	const actions = gaps
		.filter((item) => !item.resolved)
		.map((item) => item.action);
	return Array.from(new Set<ReviewInvestigationActionName>([
		...actions,
		"inspect_summary",
		"finalize_review",
	])).filter((action) => action === "finalize_review" || (!history.some((item) => item.action === action)
		&& (action !== "inspect_summary" || candidate.signals.some((signal) => !ledger.has(signal.id)))));
}

function markGapResolved(gaps: EvidenceGap[], action: ReviewInvestigationActionName): void {
	for (const gap of gaps) {
		if (gap.action === action) {
			gap.resolved = true;
		}
	}
}

function pickFallbackAction(gaps: EvidenceGap[]): ReviewInvestigationActionDraft {
	const preferred: ReviewInvestigationActionName[] = [
		"inspect_scripts",
		"inspect_config",
		"inspect_code_context",
		"search_project_knowledge",
		"inspect_summary",
		"finalize_review",
	];
	const unresolved = new Set(gaps.filter((item) => !item.resolved).map((item) => item.action));
	const action = preferred.find((item) => unresolved.has(item)) || "finalize_review";
	return {
		action,
		reason: "Deterministic fallback selected the next unresolved evidence gap.",
	};
}

function renderEvidenceLedger(ledger: Map<string, ReviewEvidenceRecord>): string[] {
	return Array.from(ledger.values()).map((item) => {
		const location = item.filePath
			? `${item.filePath}${typeof item.line === "number" ? `:${item.line}` : ""}`
			: "-";
		return `${item.id} | ${item.kind} | ${item.sourceType} | ${location} | ${item.summary}`;
	});
}

function buildInvestigationPrompt(input: {
	question?: string;
	candidate: DependencyReviewCandidate;
	overview: DependencyOverview;
	ledger: Map<string, ReviewEvidenceRecord>;
	gaps: EvidenceGap[];
	actionHistory: ReviewInvestigationActionDraft[];
	allowedActions: ReviewInvestigationActionName[];
}): string {
	return [
		buildInvestigationActionPrompt(input.question),
		"",
		"Candidate summary:",
		JSON.stringify({
			dependencyName: input.candidate.dependencyName,
			packageName: input.candidate.packageName,
			disposition: input.candidate.disposition,
			confidence: input.candidate.confidence,
			reason: input.candidate.reason,
			signalCount: input.candidate.signalCount,
			signalTypes: input.candidate.signalTypes,
			signalFileRoles: input.candidate.signalFileRoles,
		}, null, 2),
		"",
		"Overview summary:",
		JSON.stringify({
			isDeclared: input.overview.isDeclared,
			isReferenced: input.overview.isReferenced,
			isUnusedDependency: input.overview.isUnusedDependency,
			isGhostDependency: input.overview.isGhostDependency,
			referenceCount: input.overview.references.length,
			signalCount: input.overview.signals.length,
		}, null, 2),
		"",
		"Allowed actions:",
		JSON.stringify(input.allowedActions, null, 2),
		"",
		"Current evidence ledger:",
		JSON.stringify(renderEvidenceLedger(input.ledger), null, 2),
		"",
		"Evidence gaps:",
		JSON.stringify(input.gaps, null, 2),
		"",
		"Action history:",
		JSON.stringify(input.actionHistory, null, 2),
	].join("\n");
}

function buildVerdictPrompt(input: {
	question?: string;
	candidate: DependencyReviewCandidate;
	overview: DependencyOverview;
	ledger: Map<string, ReviewEvidenceRecord>;
	gaps: EvidenceGap[];
	actionHistory: ReviewInvestigationActionDraft[];
}): string {
	return [
		buildVerdictDraftPrompt(input.question),
		"",
		"Candidate summary:",
		JSON.stringify(input.candidate, null, 2),
		"",
		"Dependency overview:",
		JSON.stringify({
			dependencyName: input.overview.dependencyName,
			packageName: input.overview.packageName,
			isDeclared: input.overview.isDeclared,
			isReferenced: input.overview.isReferenced,
			isUnusedDependency: input.overview.isUnusedDependency,
			isGhostDependency: input.overview.isGhostDependency,
			referenceCount: input.overview.references.length,
			signalCount: input.overview.signals.length,
		}, null, 2),
		"",
		"Evidence ledger:",
		JSON.stringify(renderEvidenceLedger(input.ledger), null, 2),
		"",
		"Remaining evidence gaps:",
		JSON.stringify(input.gaps.filter((item) => !item.resolved), null, 2),
		"",
		"Action history:",
		JSON.stringify(input.actionHistory, null, 2),
	].join("\n");
}

function mergeEvidence(
	ledger: Map<string, ReviewEvidenceRecord>,
	records: ReviewEvidenceRecord[]
): number {
	let added = 0;
	for (const item of records) {
		if (!ledger.has(item.id)) {
			ledger.set(item.id, item);
			added += 1;
		}
	}
	return added;
}

/**
 * summarizeContext/summarizeSignals 的 filter 是「保留」谓词。
 * 旧实现在这里全部写反了：模型选择 inspect_scripts 时拿到的恰好是除脚本外的所有证据，
 * inspect_config 同理，整个定向调查环节实际上是反着喂数据的。
 */
export function filterContextByAction(
	action: ReviewInvestigationActionName,
	contextBundle: DependencyContextBundle
): ReviewEvidenceRecord[] {
	switch (action) {
		case "inspect_scripts":
			return summarizeContext(
				contextBundle,
				(item) => item.fileRole === "script"
			);
		case "inspect_config":
			return summarizeContext(
				contextBundle,
				(item) => item.fileRole === "config" || item.fileRole === "tooling"
			);
		case "inspect_code_context":
			return summarizeContext(contextBundle);
		default:
			return [];
	}
}

export function filterSignalsByAction(
	action: ReviewInvestigationActionName,
	candidate: DependencyReviewCandidate
): ReviewEvidenceRecord[] {
	switch (action) {
		case "inspect_scripts":
			return summarizeSignals(
				candidate,
				(item) => item.fileRole === "script" || item.signalType === "script-command"
			);
		case "inspect_config":
			return summarizeSignals(
				candidate,
				(item) => item.fileRole === "config" || item.fileRole === "tooling"
			);
		case "inspect_summary":
			return summarizeSignals(candidate);
		default:
			return [];
	}
}

function validateEvidenceIds(
	ledger: Map<string, ReviewEvidenceRecord>,
	draft: ReviewVerdictDraft | undefined
): {
	ids: string[];
	knowledgeIds: string[];
} {
	const cited = draft?.evidenceIds || [];
	const ids = cited.filter((id) => ledger.has(id));
	return {
		ids,
		knowledgeIds: ids.filter((id) => id.startsWith("knowledge:") || id.startsWith("memory:")),
	};
}

function applyVerdictDraft(
	candidate: DependencyReviewCandidate,
	draft: ReviewVerdictDraft,
	ledger: Map<string, ReviewEvidenceRecord>,
	knowledgeHits: ProjectKnowledgeHit[],
	rounds: number,
	options: ReviewWorkflowOptions,
	modelDistribution?: Record<DependencyReviewDisposition, number>
): DependencyReviewCandidate {
	const validEvidence = validateEvidenceIds(ledger, draft);
	const fused = fuseReviewConfidence({
		candidate,
		modelVerdict: draft,
		...(modelDistribution ? { modelDistribution } : {}),
		validEvidenceIds: validEvidence.ids,
		knowledgeHits,
		knowledgeEvidenceIds: validEvidence.knowledgeIds,
		staticWeight: options.review.confidence.staticWeight,
		modelWeight: options.review.confidence.modelWeight,
		knowledgeWeight: options.review.confidence.knowledgeWeight,
		conservativeMargin: options.review.confidence.conservativeMargin,
	});
	const nextCandidate: DependencyReviewCandidate = {
		...candidate,
		disposition: fused.verdict,
		confidence: fused.confidence,
		reason: fused.verdict === draft.verdict
			? draft.reason
			: `${draft.reason} Final confidence stayed conservative because the evidence remained mixed.`,
		reviewedByAgent: true,
		reviewEvidence: draft.evidenceNotes || [],
		reviewEvidenceIds: validEvidence.ids,
		reviewNextStep: draft.nextStepIntent || "",
		reviewParseStatus: "ok",
		reviewFallbackUsed: false,
		// 这些融合权重是手工设定、没有标注集校准过的，输出到小数点后 4 位只会制造
		// 无法证伪的精度错觉。保留两位供内部排序参考，对外以 confidence 三档为准。
		reviewConfidenceScore: Number(fused.score.toFixed(2)),
		reviewConfidenceBreakdown: fused.breakdown,
		reviewRounds: rounds,
	};

	if (fused.verdict !== candidate.disposition) {
		nextCandidate.originalDisposition = candidate.disposition;
	}

	return nextCandidate;
}

function applyFallbackCandidate(
	candidate: DependencyReviewCandidate,
	parseReason: string | undefined,
	rounds: number
): DependencyReviewCandidate {
	const reviewParseStatus = toCandidateParseStatus(parseReason as any) || "invalid-schema";
	return {
		...candidate,
		reviewedByAgent: true,
		reviewParseStatus,
		reviewFallbackUsed: true,
		reviewRounds: rounds,
	};
}

function shouldReview(candidate: DependencyReviewCandidate): boolean {
	return candidate.disposition === "needs-review" || candidate.disposition === "likely-tooling-usage";
}

function buildExpandedContextBundle(
	report: AnalysisReport,
	candidate: DependencyReviewCandidate
): DependencyContextBundle {
	return getDependencyContextBundle(
		report,
		candidate.dependencyName,
		candidate.packageName,
		12
	);
}

export async function reviewCandidateWithWorkflow(
	report: AnalysisReport,
	model: ChatOpenAI | ReviewDecisionProvider,
	candidate: DependencyReviewCandidate,
	overview: DependencyOverview,
	contextBundle: DependencyContextBundle,
	options: ReviewWorkflowOptions,
	question?: string,
	onStatus?: ReviewStatusListener | null
): Promise<ReviewWorkflowResult> {
	if (!shouldReview(candidate)) {
		return {
			candidate,
			overview,
			contextBundle,
			memoryUsed: false,
		};
	}

	const projectPath = getProjectRoot(report);
	const ledger = seedEvidenceLedger(candidate);
	const gaps = buildEvidenceGaps(candidate);
	const actionHistory: ReviewInvestigationActionDraft[] = [];
	const decisions = "provider" in model ? model : createLlmDecisionProvider(model);
	if (decisions.provider === "jev" && !gaps.some((gap) => gap.action === "inspect_code_context")) {
		gaps.push({ id: "gap:coverage", action: "inspect_code_context", description: "Local source, scripts and configuration coverage has not been inspected.", resolved: false });
	}
	let coverage: ReviewDecisionMetadata["coverage"];
	const memoryHits = options.memoryEnabled && decisions.provider === "llm" ? findRelevantMemory(report, overview) : [];
	const knowledgeHits: ProjectKnowledgeHit[] = [];
	const expandedContextBundle = buildExpandedContextBundle(report, candidate);
	const decisionMetadata: ReviewDecisionMetadata = { provider: decisions.provider, elapsedMs: 0, callCount: 0, inputTokens: 0, outputTokens: 0 };
	const started = Date.now();
	const maxRounds = decisions.provider === "jev" ? Math.min(options.review.maxRounds, 6) : options.review.maxRounds;
	function collectMetadata(metadata: ReviewDecisionMetadata): void {
		decisionMetadata.callCount += metadata.callCount;
		decisionMetadata.inputTokens += metadata.inputTokens;
		decisionMetadata.outputTokens += metadata.outputTokens;
		if (metadata.model) decisionMetadata.model = metadata.model;
		if (metadata.apiStatus) decisionMetadata.apiStatus = metadata.apiStatus;
		if (metadata.probabilities) decisionMetadata.probabilities = metadata.probabilities;
		if (metadata.distributionSource) decisionMetadata.distributionSource = metadata.distributionSource;
		if (metadata.predicateProbabilities) decisionMetadata.predicateProbabilities = metadata.predicateProbabilities;
		if (metadata.predicateSource) decisionMetadata.predicateSource = metadata.predicateSource;
		if (metadata.coverage) decisionMetadata.coverage = metadata.coverage;
		if (metadata.proposedDisposition) decisionMetadata.proposedDisposition = metadata.proposedDisposition;
		if (metadata.actionDecisions) decisionMetadata.actionDecisions = [...(decisionMetadata.actionDecisions || []), ...metadata.actionDecisions];
		if (metadata.evidenceDecisions) decisionMetadata.evidenceDecisions = metadata.evidenceDecisions;
		if (typeof metadata.confidence === "number") decisionMetadata.confidence = metadata.confidence;
		if (metadata.fallbackReason) decisionMetadata.fallbackReason = metadata.fallbackReason;
	}

	for (let round = 0; round < maxRounds; round += 1) {
		let allowedActions = getAllowedActions(gaps, actionHistory, candidate, ledger);
		if (decisions.provider === "jev" && allowedActions.some((action) => action !== "finalize_review")) {
			allowedActions = allowedActions.filter((action) => action !== "finalize_review");
		}
		if (allowedActions.length === 1 && allowedActions[0] === "finalize_review") {
			actionHistory.push({
				action: "finalize_review",
				reason: "No unresolved evidence gaps remained.",
			});
			break;
		}

		onStatus?.(`Investigating ${candidate.dependencyName} (${round + 1}/${maxRounds})`);
		const actionPromptInput = {
			candidate,
			overview,
			ledger,
			gaps,
			actionHistory,
			allowedActions,
			...(question ? { question } : {}),
		};
		const parsedAction = decisions.provider === "jev" && allowedActions.length === 1
			? { draft: { action: allowedActions[0]!, reason: "Only one uncompleted evidence investigation remains." },
				metadata: { provider: "jev" as const, elapsedMs: 0, callCount: 0, inputTokens: 0, outputTokens: 0 } }
			: await decisions.chooseAction(actionPromptInput, () => buildInvestigationPrompt(actionPromptInput)).finally(() => onStatus?.(null));
		collectMetadata(parsedAction.metadata);
		if (decisions.provider === "jev" && !parsedAction.draft) break;
		const action = parsedAction.draft && allowedActions.includes(parsedAction.draft.action)
			? parsedAction.draft
			: pickFallbackAction(gaps);
		actionHistory.push(action);

		if (action.action === "finalize_review") {
			break;
		}

		if (action.action === "inspect_summary") {
			mergeEvidence(ledger, filterSignalsByAction(action.action, candidate));
		}
		if (action.action === "inspect_scripts" || action.action === "inspect_config") {
			mergeEvidence(ledger, filterSignalsByAction(action.action, candidate));
			mergeEvidence(ledger, filterContextByAction(action.action, expandedContextBundle));
		}
		if (action.action === "inspect_code_context") {
			mergeEvidence(ledger, filterContextByAction(action.action, expandedContextBundle));
			if (decisions.provider === "jev") {
				const inspected = collectReviewCoverage(projectPath, candidate.dependencyName);
				coverage = inspected.coverage;
				if (report.kind !== "project") { coverage.complete = false; coverage.gaps.push("monorepo-consumer-scope-unverified"); }
				mergeEvidence(ledger, inspected.records);
			}
		}
		if (action.action === "search_project_knowledge") {
			const projectHits = options.review.knowledge.enabled
				? searchProjectKnowledge(projectPath, {
					dependencyName: candidate.dependencyName,
					...(candidate.packageName ? { packageName: candidate.packageName } : {}),
					signalTypes: candidate.signalTypes,
					signalRoles: candidate.signalFileRoles,
					limit: options.review.knowledge.maxHits,
				})
				: [];
			knowledgeHits.push(...projectHits.filter((hit) =>
				!knowledgeHits.some((existing) => existing.chunk.id === hit.chunk.id)
			));
			mergeEvidence(ledger, summarizeKnowledgeHits(projectHits));
			if (options.memoryEnabled) {
				mergeEvidence(ledger, summarizeMemoryHits(memoryHits));
			}
		}

		markGapResolved(gaps, action.action);
	}

	onStatus?.(`Finalizing review for ${candidate.dependencyName}`);
	const verdictPromptInput = {
		...(coverage ? { coverage } : {}),
		candidate,
		overview,
		ledger,
		gaps,
		actionHistory,
		...(question ? { question } : {}),
	};
	const parsedVerdict = decisionMetadata.fallbackReason
		? { draft: undefined, parseReason: undefined, metadata: decisionMetadata }
		: await decisions.decideVerdict(verdictPromptInput, () => buildVerdictPrompt(verdictPromptInput)).finally(() => onStatus?.(null));
	if (parsedVerdict.metadata !== decisionMetadata) collectMetadata(parsedVerdict.metadata);
	onStatus?.(null);
	let nextCandidate = parsedVerdict.draft
		? applyVerdictDraft(candidate, parsedVerdict.draft, ledger, knowledgeHits, actionHistory.length, options,
			decisions.provider === "jev" ? decisionMetadata.probabilities as Record<DependencyReviewDisposition, number> : undefined)
		: applyFallbackCandidate(candidate, parsedVerdict.parseReason, actionHistory.length);
	if (decisions.provider === "jev") {
		const verdict = parsedVerdict.draft?.verdict;
		if (!decisionMetadata.fallbackReason && gaps.some((gap) => !gap.resolved)) decisionMetadata.fallbackReason = "unresolved-gaps";
		if (!decisionMetadata.fallbackReason && verdict === "needs-review") decisionMetadata.fallbackReason = "insufficient-evidence";
		if (!decisionMetadata.fallbackReason && ((candidate.isReferenced && (verdict === "high-confidence-unused" || nextCandidate.disposition === "high-confidence-unused"))
			|| (verdict === "ghost-dependency" && (candidate.isDeclared || !candidate.isReferenced))
			|| nextCandidate.disposition !== verdict)) decisionMetadata.fallbackReason = "business-conflict";
		if (decisionMetadata.fallbackReason) {
			nextCandidate = { ...candidate, originalDisposition: candidate.originalDisposition || candidate.disposition,
				disposition: "needs-review", confidence: "low", reason: `Jev review requires manual verification (${decisionMetadata.fallbackReason}).`,
				reviewedByAgent: true, reviewFallbackUsed: true, reviewRounds: actionHistory.length,
				reviewEvidenceIds: [], reviewEvidence: [], reviewNextStep: "manual_verify_before_remove" };
			delete nextCandidate.reviewConfidenceScore;
			delete nextCandidate.reviewConfidenceBreakdown;
		}
		delete nextCandidate.reviewParseStatus;
	}
	decisionMetadata.elapsedMs = Date.now() - started;
	nextCandidate.reviewDecision = decisionMetadata;
	const validatedEvidence = validateEvidenceIds(ledger, decisions.provider === "jev"
		? { verdict: nextCandidate.disposition, confidence: nextCandidate.confidence, reason: nextCandidate.reason, evidenceIds: nextCandidate.reviewEvidenceIds || [] }
		: parsedVerdict.draft);

	if (options.memoryEnabled) {
		appendAgentMemory({
			report,
			dependencyName: nextCandidate.dependencyName,
			disposition: nextCandidate.disposition,
			confidence: nextCandidate.confidence,
			issueTypes: nextCandidate.issues.map((item) => item.issueType),
			signalTypes: nextCandidate.signalTypes,
			filePaths: nextCandidate.references.map((item) => item.filePath),
			evidenceIds: [
				...nextCandidate.declarations.map((item) => item.id),
				...nextCandidate.references.map((item) => item.id),
				...nextCandidate.issues.map((item) => item.id),
				...nextCandidate.signals.map((item) => item.id),
				...(nextCandidate.reviewEvidenceIds || []),
			],
			parseStatus: nextCandidate.reviewParseStatus,
			maxEntries: options.memoryMaxEntries,
			...(nextCandidate.packageName ? { packageName: nextCandidate.packageName } : {}),
			...(!parsedVerdict.draft ? { fallbackReason: "candidate-default-fallback" as const } : {}),
		});
	}

	if (options.telemetry.enabled) {
		appendRunSummary(report, {
			dependencyName: nextCandidate.dependencyName,
			...(nextCandidate.packageName ? { packageName: nextCandidate.packageName } : {}),
			originalDisposition: candidate.disposition,
			finalDisposition: nextCandidate.disposition,
			finalConfidence: nextCandidate.confidence,
			...(typeof nextCandidate.reviewConfidenceScore === "number"
				? { finalScore: nextCandidate.reviewConfidenceScore }
				: {}),
			...(typeof nextCandidate.reviewRounds === "number"
				? { reviewRounds: nextCandidate.reviewRounds }
				: {}),
			...(nextCandidate.reviewParseStatus
				? { parseStatus: nextCandidate.reviewParseStatus }
				: {}),
			...(typeof nextCandidate.reviewFallbackUsed === "boolean"
				? { fallbackUsed: nextCandidate.reviewFallbackUsed }
				: {}),
			memoryUsed: memoryHits.length > 0,
			decision: decisionMetadata,
			knowledgeHitCount: knowledgeHits.length,
			validEvidenceCount: validatedEvidence.ids.length,
			...(nextCandidate.reviewConfidenceBreakdown
				? { confidenceBreakdown: nextCandidate.reviewConfidenceBreakdown }
				: {}),
		}, options.telemetry.maxRuns);
	}

	return {
		candidate: nextCandidate,
		overview,
		contextBundle: expandedContextBundle,
		memoryUsed: memoryHits.length > 0,
	};
}

export function buildRemovalAssessmentFromCandidate(
	candidate: DependencyReviewCandidate
): {
	recommended: boolean;
	confidence: "low" | "medium" | "high";
	riskLevel: "low" | "medium" | "high";
	reason: string;
} {
	switch (candidate.disposition) {
		case "confirmed-used":
		case "likely-tooling-usage":
		case "ghost-dependency":
			return {
				recommended: false,
				confidence: candidate.confidence === "low" ? "medium" : candidate.confidence,
				riskLevel: "high",
				reason: candidate.reason,
			};
		case "high-confidence-unused":
			return {
				recommended: true,
				confidence: candidate.confidence,
				riskLevel: "low",
				reason: candidate.reason,
			};
		case "needs-review":
		default:
			return {
				recommended: false,
				confidence: "low",
				riskLevel: "medium",
				reason: candidate.reason,
			};
	}
}
