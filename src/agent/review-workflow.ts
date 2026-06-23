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
} from "../types";
import { getDependencyContextBundle } from "../query";
import {
	parseInvestigationActionDraft,
	parseVerdictDraft,
	toCandidateParseStatus,
} from "./draft-parser";
import { appendAgentMemory, findRelevantMemory } from "./memory";
import { fuseReviewConfidence } from "./confidence-fusion";
import { buildInvestigationActionPrompt, buildVerdictDraftPrompt } from "./model-prompts";
import { searchProjectKnowledge } from "./project-knowledge";
import { appendRunSummary } from "./telemetry";

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

function summarizeMemoryHits(
	hits: ReturnType<typeof findRelevantMemory>
): ReviewEvidenceRecord[] {
	return hits.map((hit, index) => ({
		id: `memory:${index + 1}:${hit.entry.id}`,
		kind: "claim" as const,
		sourceType: "memory" as const,
		summary: `Past review: ${hit.entry.dependencyName || "-"} => ${hit.entry.disposition || "-"} (${hit.entry.confidence || "-"})`,
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

function getAllowedActions(gaps: EvidenceGap[]): ReviewInvestigationActionName[] {
	const actions = gaps
		.filter((item) => !item.resolved)
		.map((item) => item.action);
	return Array.from(new Set<ReviewInvestigationActionName>([
		...actions,
		"inspect_summary",
		"finalize_review",
	]));
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

function filterContextByAction(
	action: ReviewInvestigationActionName,
	contextBundle: DependencyContextBundle
): ReviewEvidenceRecord[] {
	switch (action) {
		case "inspect_scripts":
			return summarizeContext(
				contextBundle,
				(item) => item.fileRole !== "script"
			);
		case "inspect_config":
			return summarizeContext(
				contextBundle,
				(item) => item.fileRole !== "config" && item.fileRole !== "tooling"
			);
		case "inspect_code_context":
			return summarizeContext(contextBundle);
		default:
			return [];
	}
}

function filterSignalsByAction(
	action: ReviewInvestigationActionName,
	candidate: DependencyReviewCandidate
): ReviewEvidenceRecord[] {
	switch (action) {
		case "inspect_scripts":
			return summarizeSignals(
				candidate,
				(item) => item.fileRole !== "script" && item.signalType !== "script-command"
			);
		case "inspect_config":
			return summarizeSignals(
				candidate,
				(item) => item.fileRole !== "config" && item.fileRole !== "tooling"
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
	options: ReviewWorkflowOptions
): DependencyReviewCandidate {
	const validEvidence = validateEvidenceIds(ledger, draft);
	const fused = fuseReviewConfidence({
		candidate,
		modelVerdict: draft,
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
		reviewConfidenceScore: Number(fused.score.toFixed(4)),
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

async function invokeJsonDraft(model: ChatOpenAI, prompt: string): Promise<string> {
	const response = await model.invoke([
		{
			role: "system",
			content: "Return plain JSON only and do not use Markdown.",
		},
		{
			role: "user",
			content: prompt,
		},
	] as any);

	return typeof response.content === "string"
		? response.content
		: JSON.stringify(response.content);
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
	model: ChatOpenAI,
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
	const memoryHits = options.memoryEnabled ? findRelevantMemory(report, overview) : [];
	const knowledgeHits: ProjectKnowledgeHit[] = [];
	const expandedContextBundle = buildExpandedContextBundle(report, candidate);

	for (let round = 0; round < options.review.maxRounds; round += 1) {
		const allowedActions = getAllowedActions(gaps);
		if (allowedActions.length === 1 && allowedActions[0] === "finalize_review") {
			actionHistory.push({
				action: "finalize_review",
				reason: "No unresolved evidence gaps remained.",
			});
			break;
		}

		onStatus?.(`Investigating ${candidate.dependencyName} (${round + 1}/${options.review.maxRounds})`);
		const actionPromptInput = {
			candidate,
			overview,
			ledger,
			gaps,
			actionHistory,
			allowedActions,
			...(question ? { question } : {}),
		};
		const actionRaw = await invokeJsonDraft(model, buildInvestigationPrompt(actionPromptInput));
		onStatus?.(null);
		const parsedAction = parseInvestigationActionDraft(actionRaw);
		const action = parsedAction.ok && parsedAction.draft && allowedActions.includes(parsedAction.draft.action)
			? parsedAction.draft
			: pickFallbackAction(gaps);
		actionHistory.push(action);

		if (action.action === "finalize_review") {
			break;
		}

		let added = 0;
		if (action.action === "inspect_summary") {
			added += mergeEvidence(ledger, filterSignalsByAction(action.action, candidate));
		}
		if (action.action === "inspect_scripts" || action.action === "inspect_config") {
			added += mergeEvidence(ledger, filterSignalsByAction(action.action, candidate));
			added += mergeEvidence(ledger, filterContextByAction(action.action, expandedContextBundle));
		}
		if (action.action === "inspect_code_context") {
			added += mergeEvidence(ledger, filterContextByAction(action.action, expandedContextBundle));
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
			added += mergeEvidence(ledger, summarizeKnowledgeHits(projectHits));
			if (options.memoryEnabled) {
				added += mergeEvidence(ledger, summarizeMemoryHits(memoryHits));
			}
		}

		markGapResolved(gaps, action.action);
		if (added === 0) {
			markGapResolved(gaps, action.action);
		}
	}

	onStatus?.(`Finalizing review for ${candidate.dependencyName}`);
	const verdictPromptInput = {
		candidate,
		overview,
		ledger,
		gaps,
		actionHistory,
		...(question ? { question } : {}),
	};
	const verdictRaw = await invokeJsonDraft(model, buildVerdictPrompt(verdictPromptInput));
	onStatus?.(null);

	const parsedVerdict = parseVerdictDraft(verdictRaw);
	const nextCandidate = parsedVerdict.ok && parsedVerdict.draft
		? applyVerdictDraft(candidate, parsedVerdict.draft, ledger, knowledgeHits, actionHistory.length, options)
		: applyFallbackCandidate(candidate, parsedVerdict.reason, actionHistory.length);
	const validatedEvidence = validateEvidenceIds(ledger, parsedVerdict.draft);

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
			...(!parsedVerdict.ok ? { fallbackReason: "candidate-default-fallback" as const } : {}),
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
