import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessageLike } from "@langchain/core/messages";
import * as z from "zod";
import {
	AnalysisReport,
	DependencyContextBundle,
	DependencyReviewCandidate,
	DependencyOverview,
	PackageIssueRankingView,
	PackageSummaryView,
	ProjectKnowledgeHit,
	ProjectSummaryView,
	RemovalAssessment,
	ReviewLocale,
	ReviewNarrativeDraft,
	ReviewStructuredAnswer,
} from "../types";
import {
	canRemoveDependency,
	getDependencyContextBundle,
	getDependencyOverview,
	getDependencyReviewCandidate,
	getDependencyReviewCandidates,
	getGhostDependencies,
	getPackageNames,
	getProblematicPackages,
	getPackageSummary,
	getProjectSummary,
	getUnusedDependencies,
} from "../query";
import { buildMissingAiConfigGuidance, initializeRuntimeEnv } from "../config/runtime";
import { readAgentProjectConfig } from "../config/project";
import {
	buildAnswer,
	buildContextBundleAnswer,
	buildDependencyNameListAnswer,
	buildPlainTextFallbackAnswer,
	buildProblematicPackagesAnswer,
	buildProjectSummaryAnswer,
	buildRemovalAssessmentAnswer,
	buildReviewCandidateAnswer,
	buildStreamingNarrativeAnswer,
	buildStrictValidationFallbackAnswer,
} from "./answer-builder";
import { parseNarrativeDraft } from "./draft-parser";
import { SYSTEM_PROMPT } from "./model-prompts";
import { createJevDecisionProvider, createLlmDecisionProvider, ensureJevConfig } from "./review-decisions";
import {
	buildRemovalAssessmentFromCandidate,
	reviewCandidateWithWorkflow,
	ReviewStatusListener,
} from "./review-workflow";
import { searchProjectKnowledge } from "./project-knowledge";
import { renderStructuredAnswer } from "./render";

initializeRuntimeEnv();

/** LangGraph 单轮问答允许的最大节点步数。 */
const AGENT_RECURSION_LIMIT = 12;

/**
 * 会话历史保留的最大消息条数。
 *
 * 历史里包含每次工具调用返回的完整 JSON（候选对象带着 declarations/references/
 * issues/signals 四个数组），不裁剪的话多轮对话后上下文会线性膨胀直至请求失败。
 */
const MAX_HISTORY_MESSAGES = 24;

function trimMessageHistory(messages: BaseMessageLike[]): BaseMessageLike[] {
	if (messages.length <= MAX_HISTORY_MESSAGES) {
		return messages;
	}
	return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
}

export interface ReviewRuntime {
	report: AnalysisReport;
	preparation: ReviewPreparationSummary;
	ask(question: string): Promise<ReviewStructuredAnswer>;
	askStream(question: string, onPartialAnswer: (partialAnswer: ReviewStructuredAnswer) => void): Promise<ReviewStructuredAnswer>;
	deepAsk(question: string): Promise<ReviewStructuredAnswer>;
	deepAskStream(question: string, onPartialAnswer: (partialAnswer: ReviewStructuredAnswer) => void): Promise<ReviewStructuredAnswer>;
	reset(): void;
	setStatusListener(listener: ReviewStatusListener | null): void;
}

export interface ReviewPreparationSummary {
	reviewedCandidateCount: number;
	confirmedUsedCount: number;
	likelyToolingUsageCount: number;
	needsReviewCount: number;
}

interface ReviewEnhancementContext {
	reviewedByKey: Map<string, DependencyReviewCandidate>;
	summary: ReviewPreparationSummary;
}

export class ReviewFallbackRequiredError extends Error {
	question: string;

	constructor(question: string, message: string) {
		super(message);
		this.name = "ReviewFallbackRequiredError";
		this.question = question;
	}
}

function getRequiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export function getMissingReviewAiEnvVars(): string[] {
	const required = ["QWEN_MODEL", "QWEN_API_KEY", "QWEN_BASE_URL"];
	return required.filter((name) => {
		const value = process.env[name];
		return !value || value.trim() === "";
	});
}

export function ensureReviewAiConfig(): void {
	const missing = getMissingReviewAiEnvVars();
	if (missing.length === 0) {
		return;
	}

	throw new Error(buildMissingAiConfigGuidance(missing));
}

export function ensureReviewDecisionConfig(report: AnalysisReport): void {
	if (readAgentProjectConfig(getProjectRoot(report)).review.provider === "jev") ensureJevConfig();
	else ensureReviewAiConfig();
}

function createDecisionProvider(report: AnalysisReport) {
	return readAgentProjectConfig(getProjectRoot(report)).review.provider === "jev"
		? createJevDecisionProvider() : createLlmDecisionProvider(createModel());
}

function createModel() {
	ensureReviewAiConfig();
	return new ChatOpenAI({
		model: getRequiredEnv("QWEN_MODEL"),
		apiKey: getRequiredEnv("QWEN_API_KEY"),
		configuration: {
			baseURL: getRequiredEnv("QWEN_BASE_URL"),
		},
	});
}

function serializeResult(
	data:
		| string[]
		| Record<string, unknown>
		| PackageIssueRankingView[]
		| ProjectSummaryView
		| PackageSummaryView
		| RemovalAssessment
		| DependencyOverview
		| DependencyContextBundle
		| DependencyReviewCandidate
		| DependencyReviewCandidate[]
		| ProjectKnowledgeHit[]
): string {
	return JSON.stringify(data, null, 2);
}

function candidateKey(dependencyName: string, packageName?: string): string {
	return `${packageName || ""}::${dependencyName}`;
}

function getProjectRoot(report: AnalysisReport): string {
	return report.kind === "project" ? report.path : report.projectPath;
}

function getEnhancedReviewCandidate(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext,
	dependencyName: string,
	packageName?: string
): DependencyReviewCandidate {
	return enhancement.reviewedByKey.get(candidateKey(dependencyName, packageName))
		|| getDependencyReviewCandidate(report, dependencyName, packageName);
}

function getEnhancedReviewCandidates(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext,
	packageName?: string
): DependencyReviewCandidate[] {
	return getDependencyReviewCandidates(report, packageName).map((candidate) =>
		getEnhancedReviewCandidate(report, enhancement, candidate.dependencyName, candidate.packageName)
	);
}

function buildEnhancedUnusedDependencyResult(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext,
	packageName?: string
) {
	const staticUnused = getUnusedDependencies(report, packageName);
	const candidates = staticUnused.map((dependencyName) =>
		getEnhancedReviewCandidate(report, enhancement, dependencyName, packageName)
	);

	return {
		mode: enhancement.summary.reviewedCandidateCount > 0 ? "reviewed" : "coarse-screening",
		highConfidenceUnused: candidates
			.filter((candidate) => candidate.disposition === "high-confidence-unused")
			.map((candidate) => candidate.dependencyName),
		likelyToolingUsage: candidates
			.filter((candidate) =>
				candidate.disposition === "likely-tooling-usage"
				|| candidate.disposition === "confirmed-used"
			)
			.map((candidate) => candidate.dependencyName),
		needsReview: candidates
			.filter((candidate) => candidate.disposition === "needs-review")
			.map((candidate) => candidate.dependencyName),
		reviewedCandidates: candidates.filter((candidate) => candidate.reviewedByAgent).length,
		warning:
			enhancement.summary.reviewedCandidateCount > 0
				? "This view includes AI review for low-confidence candidates. Dependencies in likelyToolingUsage or needsReview should still be checked before removal."
				: "This is a coarse screening result from static analysis and signals. Dependencies in likelyToolingUsage or needsReview should be reviewed further before removal.",
	};
}

function buildEnhancedRemovalAssessment(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext,
	dependencyName: string,
	packageName?: string
): RemovalAssessment {
	const candidate = getEnhancedReviewCandidate(report, enhancement, dependencyName, packageName);
	const derived = buildRemovalAssessmentFromCandidate(candidate);

	if (candidate.disposition === "high-confidence-unused") {
		return canRemoveDependency(report, dependencyName, packageName);
	}

	return {
		dependencyName,
		...(packageName ? { packageName } : {}),
		recommended: derived.recommended,
		confidence: derived.confidence,
		riskLevel: derived.riskLevel,
		reason: derived.reason,
		declarations: candidate.declarations,
		references: candidate.references,
		issues: candidate.issues,
	};
}

export async function prepareReviewEnhancement(
	report: AnalysisReport,
	onProgress?: (current: number, total: number, candidate: DependencyReviewCandidate) => void
): Promise<ReviewEnhancementContext> {
	const model = createDecisionProvider(report);
	const agentConfig = readAgentProjectConfig(getProjectRoot(report));
	const staticUnusedByPackage = new Map<string, Set<string>>();
	if (report.kind === "project") {
		staticUnusedByPackage.set("", new Set(getUnusedDependencies(report)));
	} else {
		for (const pkg of report.packages) {
			staticUnusedByPackage.set(pkg.name, new Set(pkg.unusedDependencies));
		}
	}
	const candidates = (report.kind === "project"
		? getDependencyReviewCandidates(report)
		: report.packages.flatMap((pkg) => getDependencyReviewCandidates(report, pkg.name)))
		.filter((candidate) => {
		const packageKey = candidate.packageName || "";
		const unusedSet = staticUnusedByPackage.get(packageKey);
		const isStaticUnusedCandidate = unusedSet?.has(candidate.dependencyName) || false;
		return isStaticUnusedCandidate && (
			candidate.disposition === "needs-review"
			|| candidate.disposition === "likely-tooling-usage"
		);
	});
	const reviewedByKey = new Map<string, DependencyReviewCandidate>();

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		if (!candidate) {
			continue;
		}
		onProgress?.(index + 1, candidates.length, candidate);
		const overview = getDependencyOverview(report, candidate.dependencyName, candidate.packageName);
		const contextBundle = getDependencyContextBundle(report, candidate.dependencyName, candidate.packageName);
		const workflowResult = await reviewCandidateWithWorkflow(
			report,
			model,
			candidate,
			overview,
			contextBundle,
			{
				memoryEnabled: agentConfig.memory.enabled,
				memoryMaxEntries: agentConfig.memory.maxEntries,
				review: agentConfig.review,
				telemetry: agentConfig.telemetry,
			}
		);
		reviewedByKey.set(
			candidateKey(candidate.dependencyName, candidate.packageName),
			workflowResult.candidate
		);
	}

	const reviewedCandidates = Array.from(reviewedByKey.values());
	return {
		reviewedByKey,
		summary: {
			reviewedCandidateCount: reviewedCandidates.length,
			confirmedUsedCount: reviewedCandidates.filter((item) => item.disposition === "confirmed-used").length,
			likelyToolingUsageCount: reviewedCandidates.filter((item) => item.disposition === "likely-tooling-usage").length,
			needsReviewCount: reviewedCandidates.filter((item) => item.disposition === "needs-review").length,
		},
	};
}

function createReviewTools(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext,
	onStatus?: ReviewStatusListener | null
) {
	const packageNames = getPackageNames(report);
	const requiresPackageName = report.kind === "monorepo";
	const model = createDecisionProvider(report);
	const agentConfig = readAgentProjectConfig(getProjectRoot(report));

	function withToolStatus<TArgs extends Record<string, unknown> | void>(
		label: string,
		handler: (args: TArgs) => Promise<string> | string
	) {
		return async (args: TArgs) => {
			onStatus?.(label);
			try {
				return await handler(args);
			} finally {
				onStatus?.(null);
			}
		};
	}

	return [
		tool(withToolStatus("Reading project summary", async () => serializeResult(getProjectSummary(report))), {
			name: "get_project_summary",
			description: "Get the top-level dependency analysis summary for the current project.",
			schema: z.object({}),
		}),
		tool(withToolStatus("Ranking problematic packages", async ({ limit }: { limit?: number }) => serializeResult(getProblematicPackages(report, limit))), {
			name: "get_problematic_packages",
			description: requiresPackageName
				? "Rank workspace packages by dependency issue count."
				: "Get the dependency issue ranking for the current project.",
			schema: z.object({
				limit: z.number().optional().describe("Maximum number of packages to return."),
			}),
		}),
		tool(withToolStatus("Reading package summary", async ({ packageName }: { packageName?: string }) => serializeResult(getPackageSummary(report, packageName))), {
			name: "get_package_summary",
			description: requiresPackageName
				? `Get the dependency summary for a specific package. Available packages: ${packageNames.join(", ")}`
				: "Get the dependency summary for the current project.",
			schema: z.object({
				packageName: z.string().optional().describe("Package name or relative package path."),
			}),
		}),
		tool(withToolStatus("Screening unused dependencies", async ({ packageName }: { packageName?: string }) => serializeResult(buildEnhancedUnusedDependencyResult(report, enhancement, packageName))), {
			name: "get_unused_dependencies",
			description: requiresPackageName
				? `Get the unused dependency screening view for the whole monorepo or a specific package. Available packages: ${packageNames.join(", ")}`
				: "Get the unused dependency screening view for the current project.",
			schema: z.object({
				packageName: z.string().optional().describe("Package name or relative package path."),
			}),
		}),
		tool(withToolStatus("Checking ghost dependencies", async ({ packageName }: { packageName?: string }) => serializeResult(getGhostDependencies(report, packageName))), {
			name: "get_ghost_dependencies",
			description: requiresPackageName
				? `Get ghost dependencies for the whole monorepo or a specific package. Available packages: ${packageNames.join(", ")}`
				: "Get ghost dependencies for the current project.",
			schema: z.object({
				packageName: z.string().optional().describe("Package name or relative package path."),
			}),
		}),
		tool(
			withToolStatus("Reading review candidate", async ({ dependencyName, packageName }: { dependencyName: string; packageName?: string }) =>
				serializeResult(getEnhancedReviewCandidate(report, enhancement, dependencyName, packageName))),
			{
				name: "get_dependency_review_candidate",
				description: "Get the signal-aware review candidate for a dependency.",
				schema: z.object({
					dependencyName: z.string().describe("The dependency name to review."),
					packageName: z.string().optional().describe("Package name or relative package path."),
				}),
			}
		),
		tool(
			withToolStatus("Listing review candidates", async ({ packageName }: { packageName?: string }) =>
				serializeResult(getEnhancedReviewCandidates(report, enhancement, packageName))),
			{
				name: "get_dependency_review_candidates",
				description: "Get all signal-aware review candidates.",
				schema: z.object({
					packageName: z.string().optional().describe("Package name or relative package path."),
				}),
			}
		),
		tool(
			withToolStatus("Collecting code context", async ({ dependencyName, packageName, maxSnippets }: { dependencyName: string; packageName?: string; maxSnippets?: number }) =>
				serializeResult(getDependencyContextBundle(report, dependencyName, packageName, maxSnippets))),
			{
				name: "get_dependency_context_bundle",
				description: "Get local code and config snippets related to a dependency.",
				schema: z.object({
					dependencyName: z.string().describe("The dependency name to inspect."),
					packageName: z.string().optional().describe("Package name or relative package path."),
					maxSnippets: z.number().optional().describe("Maximum number of snippets to return."),
				}),
			}
		),
		tool(
			withToolStatus("Reading dependency overview", async ({ dependencyName, packageName }: { dependencyName: string; packageName?: string }) =>
				serializeResult(getDependencyOverview(report, dependencyName, packageName))),
			{
				name: "get_dependency_overview",
				description: "Get declarations, references, issues, and usage overview for a dependency.",
				schema: z.object({
					dependencyName: z.string().describe("The dependency name to inspect."),
					packageName: z.string().optional().describe("Package name or relative package path."),
				}),
			}
		),
		tool(
			withToolStatus("Searching project knowledge", async ({
				dependencyName,
				packageName,
			}: {
				dependencyName: string;
				packageName?: string;
			}) => serializeResult(searchProjectKnowledge(getProjectRoot(report), {
				dependencyName,
				...(packageName ? { packageName } : {}),
				limit: 5,
			}))),
			{
				name: "search_project_knowledge",
				description: "Search README, AGENTS, project rules, and local knowledge notes related to a dependency.",
				schema: z.object({
					dependencyName: z.string().describe("The dependency name to inspect."),
					packageName: z.string().optional().describe("Package name or relative package path."),
				}),
			}
		),
		tool(
			withToolStatus("Running second-pass review", async ({
				dependencyName,
				packageName,
				question,
			}: {
				dependencyName: string;
				packageName?: string;
				question?: string;
			}) => {
				const candidate = getEnhancedReviewCandidate(report, enhancement, dependencyName, packageName);
				const overview = getDependencyOverview(report, dependencyName, packageName);
				const contextBundle = getDependencyContextBundle(report, dependencyName, packageName);
				const workflowResult = await reviewCandidateWithWorkflow(
					report,
					model,
					candidate,
					overview,
					contextBundle,
					{
						memoryEnabled: agentConfig.memory.enabled,
						memoryMaxEntries: agentConfig.memory.maxEntries,
						review: agentConfig.review,
						telemetry: agentConfig.telemetry,
					},
					question,
					onStatus
				);
				return JSON.stringify(workflowResult.candidate, null, 2);
			}),
			{
				name: "review_dependency_candidate",
				description: "Run a controlled second-pass review for an ambiguous dependency candidate.",
				schema: z.object({
					dependencyName: z.string().describe("The dependency name to review."),
					packageName: z.string().optional().describe("Package name or relative package path."),
					question: z.string().optional().describe("The user's original question for extra context."),
				}),
			}
		),
		tool(
			withToolStatus("Assessing removal risk", async ({ dependencyName, packageName }: { dependencyName: string; packageName?: string }) =>
				serializeResult(buildEnhancedRemovalAssessment(report, enhancement, dependencyName, packageName))),
			{
				name: "can_remove_dependency",
				description: "Assess whether a dependency can be removed safely.",
				schema: z.object({
					dependencyName: z.string().describe("The dependency name to assess."),
					packageName: z.string().optional().describe("Package name or relative package path."),
				}),
			}
		),
	];
}

function extractFinalText(result: any): string {
	const finalMessage = result.messages[result.messages.length - 1];
	if (!finalMessage) {
		throw new Error("Agent returned no final message.");
	}

	return typeof finalMessage.content === "string"
		? finalMessage.content
		: JSON.stringify(finalMessage.content);
}

function detectQuestionLocale(question: string): ReviewLocale {
	const normalized = question.trim();
	if (normalized === "") {
		return "zh";
	}
	return /[\u4e00-\u9fff]/.test(normalized) ? "zh" : "en";
}

function buildLanguageInstruction(locale: ReviewLocale): string {
	return locale === "zh"
		? "The user's most recent message is in Chinese. Reply in Chinese."
		: "The user's most recent message is in English. Reply in English.";
}

/**
 * 判断错误是否属于「工具路由走不通」，可以升级到深度分析。
 *
 * 旧实现里有一条 `error.message.includes("tool")`，任何消息里带 "tool" 子串的错误
 * （包括网络错误、鉴权错误）都会被当成路由失败，把真实故障伪装成需要深度分析。
 */
function shouldEscalateToDeepAnalysis(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message;
	return message.includes("Recursion limit")
		|| message.includes("GraphRecursionError")
		|| message.includes("Agent returned no final message")
		|| /tool[_ ]call|tool not found|unknown tool|invalid tool/i.test(message);
}

function buildNarrativeAnswer(draft: ReviewNarrativeDraft, locale: ReviewLocale, summaryFallback: string): ReviewStructuredAnswer {
	const input = {
		locale,
		type: "text",
		summary: draft.summary || summaryFallback,
		...(draft.title ? { title: draft.title } : {}),
		...(draft.displayStyle ? { displayStyle: draft.displayStyle } : {}),
		...(draft.accentTone ? { accentTone: draft.accentTone } : {}),
	} as const;
	return buildAnswer({
		...input,
		...(draft.findings ? { findings: draft.findings } : {}),
		...(draft.citations ? { citations: draft.citations } : {}),
		...(draft.nextActionIntent ? { nextActionIntent: draft.nextActionIntent } : {}),
	});
}

function findMentionedDependency(report: AnalysisReport, question: string): string | undefined {
	const dependencyNames = getDependencyReviewCandidates(report)
		.map((item) => item.dependencyName)
		.sort((a, b) => b.length - a.length);
	const lower = question.toLowerCase();

	return dependencyNames.find((dependencyName) => {
		const escaped = dependencyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(^|[^a-zA-Z0-9@._/-])${escaped}(?=$|[^a-zA-Z0-9@._/-])`, "i").test(lower);
	});
}

function tryBuildDeterministicAnswer(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext,
	question: string,
	locale: ReviewLocale
): ReviewStructuredAnswer | null {
	const normalized = question.toLowerCase();
	const dependencyName = findMentionedDependency(report, question);

	if (/unused dependenc|未使用依赖/.test(normalized)) {
		const screening = buildEnhancedUnusedDependencyResult(report, enhancement);
		return buildDependencyNameListAnswer(
			locale === "zh" ? "未使用依赖筛查" : "Unused Dependency Screening",
			screening.warning,
			screening.highConfidenceUnused.concat(
				screening.likelyToolingUsage.map((item) => `${item} (${locale === "zh" ? "可能工具链使用" : "likely tooling usage"})`),
				screening.needsReview.map((item) => `${item} (${locale === "zh" ? "仍需复核" : "needs review"})`)
			),
			locale,
			["review_unused_dependencies"]
		);
	}

	if (/ghost dependenc|幽灵依赖/.test(normalized)) {
		return buildDependencyNameListAnswer(
			locale === "zh" ? "幽灵依赖" : "Ghost Dependencies",
			locale === "zh" ? "这些依赖在代码中被引用，但当前作用域中没有声明。" : "These dependencies are referenced but not declared in the current scope.",
			getGhostDependencies(report),
			locale,
			["review_ghost_dependencies"]
		);
	}

	if (/problematic package|most dependency issues|问题最多的包|最有问题的包/.test(normalized)) {
		return buildProblematicPackagesAnswer(getProblematicPackages(report, 5), locale);
	}

	if (/project summary|summary|概览|总览/.test(normalized) && !dependencyName) {
		return buildProjectSummaryAnswer(getProjectSummary(report), locale);
	}

	if (!dependencyName) {
		return null;
	}

	if (/can .*remove|safe to remove|可以移除|能删|能不能删/.test(normalized)) {
		return buildRemovalAssessmentAnswer(
			buildEnhancedRemovalAssessment(report, enhancement, dependencyName),
			locale
		);
	}

	if (/where .*used|why .*used|在哪里使用|哪里使用|为什么.*使用|间接使用/.test(normalized)) {
		return buildContextBundleAnswer(
			getDependencyContextBundle(report, dependencyName),
			locale
		);
	}

	if (/review candidate|overview|为什么|判定|判断|结论/.test(normalized)) {
		return buildReviewCandidateAnswer(
			getEnhancedReviewCandidate(report, enhancement, dependencyName),
			locale
		);
	}

	return null;
}

/** 深度分析提示词的字符预算，约等于 30k token。超出部分按重要性裁剪。 */
const DEEP_ANALYSIS_CHAR_BUDGET = 120_000;

/**
 * 为深度分析构造一个「有预算」的报告视图。
 *
 * 旧实现直接 JSON.stringify 整份报告（含全部 declarations/references/signals），
 * 中等规模的 monorepo 就会把上下文顶爆，UI 上只提示「可能消耗很多 token」，
 * 实际结果是请求直接失败。这里改成按重要性分层裁剪，并显式告知模型裁掉了什么。
 */
function buildDeepAnalysisPayload(report: AnalysisReport, question: string): {
	payload: string;
	truncatedNotes: string[];
} {
	const truncatedNotes: string[] = [];
	const lowerQuestion = question.toLowerCase();

	const relevantIssues = (report.kind === "project"
		? report.evidence.issues
		: report.evidenceIndex.issues
	);
	// 与问题里出现的依赖名相关的证据优先保留。
	const mentioned = new Set(
		relevantIssues
			.map((item) => item.dependencyName)
			.filter((name) => lowerQuestion.includes(name.toLowerCase()))
	);

	const rank = (dependencyName: string) => (mentioned.has(dependencyName) ? 0 : 1);
	const take = <T extends { dependencyName: string }>(items: T[], limit: number, label: string): T[] => {
		const sorted = [...items].sort((a, b) => rank(a.dependencyName) - rank(b.dependencyName));
		if (sorted.length <= limit) return sorted;
		truncatedNotes.push(`${label}: showing ${limit} of ${sorted.length}`);
		return sorted.slice(0, limit);
	};

	const base = report.kind === "project"
		? {
			kind: report.kind,
			path: report.path,
			summary: report.summary,
			issues: take(report.evidence.issues, 120, "issues"),
			references: take(report.evidence.references, 200, "references"),
			signals: take(report.evidence.signals, 120, "signals"),
			declarations: take(report.evidence.declarations, 200, "declarations"),
		}
		: {
			kind: report.kind,
			projectPath: report.projectPath,
			monorepoType: report.monorepoType,
			packageCount: report.packageCount,
			packages: report.packages.map((pkg) => ({
				name: pkg.name,
				path: pkg.path,
				summary: pkg.summary,
				ghostDependencies: pkg.ghostDependencies,
				undeclaredWorkspaceDependencies: pkg.undeclaredWorkspaceDependencies,
			})),
			issues: take(report.evidenceIndex.issues, 150, "issues"),
			signals: take(report.evidenceIndex.signals, 120, "signals"),
		};

	let payload = JSON.stringify(base, null, 2);
	if (payload.length > DEEP_ANALYSIS_CHAR_BUDGET) {
		payload = payload.slice(0, DEEP_ANALYSIS_CHAR_BUDGET);
		truncatedNotes.push(`payload hard-truncated at ${DEEP_ANALYSIS_CHAR_BUDGET} characters`);
	}

	return { payload, truncatedNotes };
}

function buildDeepAnalysisPrompt(report: AnalysisReport, question: string): string {
	const { payload, truncatedNotes } = buildDeepAnalysisPayload(report, question);
	return [
		"Use the cached analysis report below to answer the question.",
		"Return a compact JSON draft inside <deplens_draft> markers.",
		truncatedNotes.length > 0
			? `The report was trimmed to fit the context window (${truncatedNotes.join("; ")}). Say so if the answer depends on the omitted parts.`
			: "The report below is complete.",
		"",
		`Question: ${question}`,
		"",
		"Report:",
		payload,
	].join("\n");
}

function extractStreamTextChunk(chunk: unknown): string {
	if (typeof chunk === "string") {
		return chunk;
	}

	if (!chunk || typeof chunk !== "object") {
		return "";
	}

	const content = (chunk as { content?: unknown }).content;
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((item) => {
			if (typeof item === "string") {
				return item;
			}
			if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
				return (item as { text: string }).text;
			}
			return "";
		})
		.join("");
}

function updateVisibleDraftText(
	buffer: string,
	visible: string
): {
	visible: string;
	changed: boolean;
} {
	const markerIndex = buffer.indexOf("<deplens_draft>");
	if (markerIndex < 0) {
		return {
			visible,
			changed: false,
		};
	}

	const nextVisible = buffer.slice(markerIndex);
	return {
		visible: nextVisible,
		changed: nextVisible !== visible,
	};
}

function findJsonKeyIndex(source: string, key: string): number {
	return source.search(new RegExp(`"${key}"\\s*:\\s*`, "m"));
}

function readJsonStringValue(source: string, startQuoteIndex: number): {
	value: string;
	end: number;
	complete: boolean;
} {
	let result = "";
	let index = startQuoteIndex + 1;

	while (index < source.length) {
		const char = source[index];
		if (char === "\\") {
			const next = source[index + 1];
			if (next === undefined) {
				return { value: result, end: source.length, complete: false };
			}
			switch (next) {
				case '"':
				case "\\":
				case "/":
					result += next;
					index += 2;
					break;
				case "b":
					result += "\b";
					index += 2;
					break;
				case "f":
					result += "\f";
					index += 2;
					break;
				case "n":
					result += "\n";
					index += 2;
					break;
				case "r":
					result += "\r";
					index += 2;
					break;
				case "t":
					result += "\t";
					index += 2;
					break;
				case "u": {
					const hex = source.slice(index + 2, index + 6);
					if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
						return { value: result, end: source.length, complete: false };
					}
					result += String.fromCharCode(parseInt(hex, 16));
					index += 6;
					break;
				}
				default:
					result += next;
					index += 2;
					break;
			}
			continue;
		}

		if (char === '"') {
			return {
				value: result,
				end: index,
				complete: true,
			};
		}

		result += char;
		index += 1;
	}

	return {
		value: result,
		end: source.length,
		complete: false,
	};
}

function extractPartialStringField(source: string, key: string): string | undefined {
	const keyIndex = findJsonKeyIndex(source, key);
	if (keyIndex < 0) {
		return undefined;
	}
	const colonIndex = source.indexOf(":", keyIndex);
	if (colonIndex < 0) {
		return undefined;
	}
	const quoteIndex = source.indexOf('"', colonIndex);
	if (quoteIndex < 0) {
		return undefined;
	}
	return readJsonStringValue(source, quoteIndex).value;
}

function extractPartialStringArrayField(source: string, key: string): string[] {
	const keyIndex = findJsonKeyIndex(source, key);
	if (keyIndex < 0) {
		return [];
	}
	const bracketIndex = source.indexOf("[", keyIndex);
	if (bracketIndex < 0) {
		return [];
	}

	const items: string[] = [];
	let index = bracketIndex + 1;
	while (index < source.length) {
		while (index < source.length && /[\s,]/.test(source[index] || "")) {
			index += 1;
		}
		const char = source[index];
		if (char === "]") {
			break;
		}
		if (char !== '"') {
			break;
		}
		const parsed = readJsonStringValue(source, index);
		if (parsed.value.trim() !== "") {
			items.push(parsed.value);
		}
		if (!parsed.complete) {
			break;
		}
		index = parsed.end + 1;
	}
	return items;
}

function extractPartialNarrativeDraft(rawBuffer: string): {
	title?: string;
	summary?: string;
	findings?: string[];
	citations?: string[];
	displayStyle?: "compact" | "standard" | "analysis";
	accentTone?: "neutral" | "info" | "success" | "warning" | "muted";
} | null {
	const markerIndex = rawBuffer.indexOf("<deplens_draft>");
	if (markerIndex < 0) {
		return null;
	}

	const visible = rawBuffer.slice(markerIndex);
	const title = extractPartialStringField(visible, "title");
	const summary = extractPartialStringField(visible, "summary");
	const findings = extractPartialStringArrayField(visible, "findings");
	const citations = extractPartialStringArrayField(visible, "citations");
	const partial: {
		title?: string;
		summary?: string;
		findings?: string[];
		citations?: string[];
		displayStyle?: "compact" | "standard" | "analysis";
		accentTone?: "neutral" | "info" | "success" | "warning" | "muted";
	} = {};

	if (title !== undefined) {
		partial.title = title;
	}
	if (summary !== undefined) {
		partial.summary = summary;
	}
	if (findings.length > 0) {
		partial.findings = findings;
	}
	if (citations.length > 0) {
		partial.citations = citations;
	}
	const displayStyle = extractPartialStringField(visible, "displayStyle");
	if (displayStyle === "compact" || displayStyle === "standard" || displayStyle === "analysis") {
		partial.displayStyle = displayStyle;
	}
	const accentTone = extractPartialStringField(visible, "accentTone");
	if (accentTone === "neutral" || accentTone === "info" || accentTone === "success" || accentTone === "warning" || accentTone === "muted") {
		partial.accentTone = accentTone;
	}

	return partial;
}

export function createReviewRuntime(
	report: AnalysisReport,
	enhancement: ReviewEnhancementContext = {
		reviewedByKey: new Map<string, DependencyReviewCandidate>(),
		summary: {
			reviewedCandidateCount: 0,
			confirmedUsedCount: 0,
			likelyToolingUsageCount: 0,
			needsReviewCount: 0,
		},
	}
): ReviewRuntime {
	const model = createModel();
	const projectConfig = readAgentProjectConfig(getProjectRoot(report));
	let statusListener: ReviewStatusListener | null = null;
	const agent = createAgent({
		model,
		tools: createReviewTools(report, enhancement, (status) => statusListener?.(status)),
		systemPrompt: SYSTEM_PROMPT,
	});
	let messageHistory: BaseMessageLike[] = [];

	async function runAsk(
		question: string,
		onPartialAnswer?: (partialAnswer: ReviewStructuredAnswer) => void
	): Promise<ReviewStructuredAnswer> {
		const locale = detectQuestionLocale(question);
		const deterministic = tryBuildDeterministicAnswer(report, enhancement, question, locale);
		if (deterministic) {
			return deterministic;
		}

		try {
			if (onPartialAnswer) {
				// recursionLimit 属于 RunnableConfig（第二个参数），放进 input 对象是不生效的。
				const stream = agent.streamEvents({
					messages: [
						...messageHistory,
						{ role: "system", content: buildLanguageInstruction(locale) },
						{ role: "user", content: question },
					],
				}, {
					version: "v2",
					recursionLimit: AGENT_RECURSION_LIMIT,
				});
				let rawBuffer = "";
				let visibleText = "";
				let lastRendered = "";
				let finalState: any = null;

				for await (const event of stream) {
					if (event.event === "on_chat_model_stream") {
						const delta = extractStreamTextChunk(event.data?.chunk);
						if (delta === "") {
							continue;
						}
						rawBuffer += delta;
						const next = updateVisibleDraftText(rawBuffer, visibleText);
						if (next.changed) {
							visibleText = next.visible;
							const partialDraft = extractPartialNarrativeDraft(rawBuffer);
							if (partialDraft) {
								const partialAnswer = buildStreamingNarrativeAnswer(partialDraft, locale);
								const rendered = renderStructuredAnswer(partialAnswer);
								if (rendered !== lastRendered) {
									lastRendered = rendered;
									onPartialAnswer(partialAnswer);
								}
							}
						}
						continue;
					}

					if (event.event === "on_chain_end" && event.name === "LangGraph") {
						finalState = event.data?.output;
					}
				}

				if (finalState?.messages) {
					messageHistory = trimMessageHistory(finalState.messages);
					const rawText = extractFinalText(finalState);
					const parsed = parseNarrativeDraft(rawText);
					if (parsed.ok && parsed.draft) {
						return buildNarrativeAnswer(parsed.draft, locale, rawText.trim());
					}
					return buildPlainTextFallbackAnswer(rawText, locale);
				}

				const parsed = parseNarrativeDraft(rawBuffer);
				if (parsed.ok && parsed.draft) {
					return buildNarrativeAnswer(parsed.draft, locale, rawBuffer.trim());
				}
				return buildPlainTextFallbackAnswer(rawBuffer, locale);
			}

			const result = await agent.invoke({
				messages: [
					...messageHistory,
					{ role: "system", content: buildLanguageInstruction(locale) },
					{ role: "user", content: question },
				],
			}, {
				recursionLimit: AGENT_RECURSION_LIMIT,
			});
			messageHistory = trimMessageHistory(result.messages);
			const rawText = extractFinalText(result);
			const parsed = parseNarrativeDraft(rawText);
			if (parsed.ok && parsed.draft) {
				return buildNarrativeAnswer(parsed.draft, locale, rawText.trim());
			}
			// 旧实现里 strictValidation 的两个分支返回完全相同的东西，等于这个配置项从未生效。
			return projectConfig.output.strictValidation
				? buildStrictValidationFallbackAnswer(rawText, locale, parsed.reason)
				: buildPlainTextFallbackAnswer(rawText, locale);
		} catch (error) {
			if (shouldEscalateToDeepAnalysis(error)) {
				throw new ReviewFallbackRequiredError(
					question,
					"The current tool route could not answer this reliably. Deep analysis can use the full report and evidence, but it may consume many tokens."
				);
			}
			throw error;
		}
	}

	async function runDeepAsk(
		question: string,
		onPartialAnswer?: (partialAnswer: ReviewStructuredAnswer) => void
	): Promise<ReviewStructuredAnswer> {
		const locale = detectQuestionLocale(question);
		const messages = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "system", content: buildLanguageInstruction(locale) },
			{ role: "user", content: buildDeepAnalysisPrompt(report, question) },
		] as any;

		if (onPartialAnswer) {
			const stream = await model.stream(messages);
			let rawBuffer = "";
			let visibleText = "";
			let lastRendered = "";
			for await (const chunk of stream as AsyncIterable<unknown>) {
				const delta = extractStreamTextChunk(chunk);
				if (delta === "") {
					continue;
				}
				rawBuffer += delta;
				const next = updateVisibleDraftText(rawBuffer, visibleText);
				if (next.changed) {
					visibleText = next.visible;
					const partialDraft = extractPartialNarrativeDraft(rawBuffer);
					if (partialDraft) {
						const partialAnswer = buildStreamingNarrativeAnswer(partialDraft, locale);
						const rendered = renderStructuredAnswer(partialAnswer);
						if (rendered !== lastRendered) {
							lastRendered = rendered;
							onPartialAnswer(partialAnswer);
						}
					}
				}
			}

			const parsed = parseNarrativeDraft(rawBuffer);
			if (parsed.ok && parsed.draft) {
				return buildNarrativeAnswer(parsed.draft, locale, rawBuffer.trim());
			}
			return buildPlainTextFallbackAnswer(rawBuffer, locale);
		}

		const response = await model.invoke(messages);
		const rawText = typeof response.content === "string"
			? response.content
			: JSON.stringify(response.content);
		const parsed = parseNarrativeDraft(rawText);
		if (parsed.ok && parsed.draft) {
			return buildNarrativeAnswer(parsed.draft, locale, rawText.trim());
		}
		return buildPlainTextFallbackAnswer(rawText, locale);
	}

	return {
		report,
		preparation: enhancement.summary,
		async ask(question: string): Promise<ReviewStructuredAnswer> {
			return runAsk(question);
		},
		async askStream(question: string, onPartialAnswer: (partialAnswer: ReviewStructuredAnswer) => void): Promise<ReviewStructuredAnswer> {
			return runAsk(question, onPartialAnswer);
		},
		async deepAsk(question: string): Promise<ReviewStructuredAnswer> {
			return runDeepAsk(question);
		},
		async deepAskStream(question: string, onPartialAnswer: (partialAnswer: ReviewStructuredAnswer) => void): Promise<ReviewStructuredAnswer> {
			return runDeepAsk(question, onPartialAnswer);
		},
		reset() {
			messageHistory = [];
		},
		setStatusListener(listener: ReviewStatusListener | null) {
			statusListener = listener;
		},
	};
}

export async function prepareReviewRuntime(
	report: AnalysisReport,
	onProgress?: (current: number, total: number, candidate: DependencyReviewCandidate) => void
): Promise<ReviewRuntime> {
	const enhancement = await prepareReviewEnhancement(report, onProgress);
	return createReviewRuntime(report, enhancement);
}

export async function runReview(question: string, report: AnalysisReport): Promise<ReviewStructuredAnswer> {
	return createReviewRuntime(report).ask(question);
}
