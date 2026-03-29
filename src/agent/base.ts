import "dotenv/config";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import * as z from "zod";
import {
	AnalysisReport,
	DependencyContextBundle,
	DependencyReviewCandidate,
	DependencyReviewDisposition,
	DependencyOverview,
	PackageIssueRankingView,
	PackageSummaryView,
	ProjectSummaryView,
	RemovalAssessment,
	ReviewLocale,
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
import { buildFallbackStructuredAnswer } from "./render";
import { SYSTEM_PROMPT } from "./config";

export interface ReviewRuntime {
	report: AnalysisReport;
	preparation: ReviewPreparationSummary;
	ask(question: string): Promise<ReviewStructuredAnswer>;
	deepAsk(question: string): Promise<ReviewStructuredAnswer>;
	reset(): void;
	setStatusListener(listener: ReviewStatusListener | null): void;
}

export type ReviewStatusListener = (status: string | null) => void;

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

interface SecondaryReviewResult {
	dependencyName: string;
	packageName?: string;
	verdict: DependencyReviewDisposition;
	confidence: "low" | "medium" | "high";
	reason: string;
	evidence?: string[];
	nextStep?: string;
}

function buildSecondaryReviewResult(base: Omit<SecondaryReviewResult, "packageName">, packageName?: string): SecondaryReviewResult {
	if (!packageName) {
		return base;
	}
	return {
		...base,
		packageName,
	};
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

	throw new Error(
		`AI review features require these environment variables: ${missing.join(", ")}. Configure them in your environment or .env file before using review or --preReview.`
	);
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
): string {
	return JSON.stringify(data, null, 2);
}

function candidateKey(dependencyName: string, packageName?: string): string {
	return `${packageName || ""}::${dependencyName}`;
}

function buildSecondaryReviewPrompt(
	question: string | undefined,
	candidate: DependencyReviewCandidate,
	overview: DependencyOverview,
	contextBundle: DependencyContextBundle
): string {
	return [
		"You are a second-pass dependency review assistant.",
		"Your task is to review a low-confidence or non-standard dependency usage case.",
		"Use the local code context snippets to determine whether the dependency is indirectly used via tooling, config, scripts, or helper code.",
		"Use only the evidence below. Do not invent extra facts.",
		"Return plain JSON only.",
		"",
		"JSON schema:",
		"{",
		'  "dependencyName": "string",',
		'  "packageName": "string or empty",',
		'  "verdict": "confirmed-used | likely-tooling-usage | needs-review | high-confidence-unused | ghost-dependency",',
		'  "confidence": "low | medium | high",',
		'  "reason": "short explanation",',
		'  "evidence": ["plain text evidence lines"],',
		'  "nextStep": "short recommended next step"',
		"}",
		"",
		`User question: ${question || "No extra user question was provided."}`,
		"",
		"Review candidate:",
		JSON.stringify(candidate, null, 2),
		"",
		"Dependency overview:",
		JSON.stringify(overview, null, 2),
		"",
		"Local code context bundle:",
		JSON.stringify(contextBundle, null, 2),
	].join("\n");
}

function parseSecondaryReviewResult(
	rawText: string,
	candidate: DependencyReviewCandidate
): SecondaryReviewResult {
	const trimmed = rawText.trim();
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	const jsonText =
		firstBrace >= 0 && lastBrace > firstBrace
			? trimmed.slice(firstBrace, lastBrace + 1)
			: trimmed;

	try {
		const parsed = JSON.parse(jsonText) as Partial<SecondaryReviewResult>;
		const verdict = parsed.verdict || candidate.disposition;
		const confidence = parsed.confidence || candidate.confidence;
		const reason = parsed.reason || candidate.reason;
		const evidence = Array.isArray(parsed.evidence)
			? parsed.evidence.filter((item): item is string => typeof item === "string")
			: [];
		return buildSecondaryReviewResult({
			dependencyName: parsed.dependencyName || candidate.dependencyName,
			verdict,
			confidence,
			reason,
			evidence,
			nextStep: parsed.nextStep || "",
		}, parsed.packageName || candidate.packageName);
	} catch {
		return buildSecondaryReviewResult({
			dependencyName: candidate.dependencyName,
			verdict: candidate.disposition,
			confidence: candidate.confidence,
			reason: candidate.reason,
			evidence: [],
			nextStep: "",
		}, candidate.packageName);
	}
}

async function runSecondaryReview(
	model: ReturnType<typeof createModel>,
	candidate: DependencyReviewCandidate,
	overview: DependencyOverview,
	contextBundle: DependencyContextBundle,
	question?: string,
	onStatus?: ReviewStatusListener | null
): Promise<SecondaryReviewResult> {
	onStatus?.(`Reviewing ${candidate.dependencyName}`);
	const response = await model.invoke([
		{
			role: "system",
			content:
				"You are a dependency review verifier. Return plain JSON only and do not use Markdown.",
		},
		{
			role: "user",
			content: buildSecondaryReviewPrompt(question, candidate, overview, contextBundle),
		},
	] as any);
	const rawText =
		typeof response.content === "string"
			? response.content
			: JSON.stringify(response.content);
	onStatus?.(null);
	return parseSecondaryReviewResult(rawText, candidate);
}

function mergeReviewedCandidate(
	candidate: DependencyReviewCandidate,
	review: SecondaryReviewResult
): DependencyReviewCandidate {
	const merged: DependencyReviewCandidate = {
		...candidate,
		disposition: review.verdict,
		confidence: review.confidence,
		reason: review.reason,
		reviewedByAgent: true,
	};

	if (review.verdict !== candidate.disposition) {
		merged.originalDisposition = candidate.disposition;
	}
	if (review.evidence && review.evidence.length > 0) {
		merged.reviewEvidence = review.evidence;
	}
	if (review.nextStep) {
		merged.reviewNextStep = review.nextStep;
	}

	return merged;
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
		mode: enhancement.summary.reviewedCandidateCount > 0 ? "pre-reviewed" : "coarse-screening",
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
				? "This view includes AI pre-review for low-confidence candidates. Dependencies in likelyToolingUsage or needsReview should still be checked before removal."
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

	if (candidate.disposition === "confirmed-used" || candidate.disposition === "likely-tooling-usage") {
		return {
			dependencyName,
			...(packageName ? { packageName } : {}),
			recommended: false,
			confidence: candidate.confidence === "low" ? "medium" : candidate.confidence,
			riskLevel: "high",
			reason: candidate.reviewedByAgent
				? `AI pre-review suggests this dependency is still used indirectly. ${candidate.reason}`
				: "Signals suggest this dependency is still used indirectly through config, scripts, or tooling.",
			declarations: candidate.declarations,
			references: candidate.references,
			issues: candidate.issues,
		};
	}

	if (candidate.disposition === "needs-review") {
		return {
			dependencyName,
			...(packageName ? { packageName } : {}),
			recommended: false,
			confidence: "low",
			riskLevel: "medium",
			reason: candidate.reviewedByAgent
				? `AI pre-review still considers this dependency ambiguous. ${candidate.reason}`
				: "This dependency has non-standard usage signals and still needs manual review before removal.",
			declarations: candidate.declarations,
			references: candidate.references,
			issues: candidate.issues,
		};
	}

	return canRemoveDependency(report, dependencyName, packageName);
}

export async function prepareReviewEnhancement(
	report: AnalysisReport,
	onProgress?: (current: number, total: number, candidate: DependencyReviewCandidate) => void
): Promise<ReviewEnhancementContext> {
	const model = createModel();
	const staticUnusedByPackage = new Map<string, Set<string>>();
	if (report.kind === "project") {
		staticUnusedByPackage.set("", new Set(getUnusedDependencies(report)));
	} else {
		for (const pkg of report.packages) {
			staticUnusedByPackage.set(pkg.name, new Set(pkg.unusedDependencies));
		}
	}
	const candidates = getDependencyReviewCandidates(report).filter(
		(candidate) => {
			const packageKey = candidate.packageName || "";
			const unusedSet = staticUnusedByPackage.get(packageKey);
			const isStaticUnusedCandidate = unusedSet?.has(candidate.dependencyName) || false;
			return isStaticUnusedCandidate && (
				candidate.disposition === "needs-review"
				|| candidate.disposition === "likely-tooling-usage"
			);
		}
	);
	const reviewedByKey = new Map<string, DependencyReviewCandidate>();

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		if (!candidate) {
			continue;
		}
		onProgress?.(index + 1, candidates.length, candidate);
		const overview = getDependencyOverview(report, candidate.dependencyName, candidate.packageName);
		const contextBundle = getDependencyContextBundle(report, candidate.dependencyName, candidate.packageName);
		const review = await runSecondaryReview(model, candidate, overview, contextBundle);
		const merged = mergeReviewedCandidate(candidate, review);
		reviewedByKey.set(candidateKey(candidate.dependencyName, candidate.packageName), merged);
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
	const model = createModel();

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
				? `Get the unused dependency screening view for the whole monorepo or a specific package. The result separates high-confidence unused items from suspicious candidates that should be reviewed before removal. Available packages: ${packageNames.join(", ")}`
				: "Get the unused dependency screening view for the current project. The result separates high-confidence unused items from suspicious candidates that should be reviewed before removal.",
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
				description: requiresPackageName
					? `Get the signal-aware review candidate for a dependency. Use this before deciding whether a non-standard dependency may still be used indirectly. Available packages: ${packageNames.join(", ")}`
					: "Get the signal-aware review candidate for a dependency. Use this before deciding whether a non-standard dependency may still be used indirectly.",
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
				description: requiresPackageName
					? `Get all signal-aware review candidates for the monorepo or for a specific package. Available packages: ${packageNames.join(", ")}`
					: "Get all signal-aware review candidates for the current project.",
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
				description: requiresPackageName
					? `Get local code and config snippets related to a dependency, based on static references and signals. Use this when you need concrete code context before deciding whether a dependency is indirectly used. Available packages: ${packageNames.join(", ")}`
					: "Get local code and config snippets related to a dependency, based on static references and signals. Use this when you need concrete code context before deciding whether a dependency is indirectly used.",
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
				description: requiresPackageName
					? `Get declarations, references, issues, and usage overview for a dependency. Available packages: ${packageNames.join(", ")}`
					: "Get declarations, references, issues, and usage overview for a dependency in the current project.",
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
				const review = await runSecondaryReview(model, candidate, overview, contextBundle, question, onStatus);
				return JSON.stringify(review, null, 2);
			}),
			{
				name: "review_dependency_candidate",
				description: requiresPackageName
					? `Run an AI-assisted second-pass review for a dependency candidate when standard references are missing but signals suggest indirect usage. Use this only after checking get_dependency_review_candidate. Available packages: ${packageNames.join(", ")}`
					: "Run an AI-assisted second-pass review for a dependency candidate when standard references are missing but signals suggest indirect usage. Use this only after checking get_dependency_review_candidate.",
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
				description: requiresPackageName
					? `Assess whether a dependency can be removed safely. Available packages: ${packageNames.join(", ")}`
					: "Assess whether a dependency can be removed safely in the current project.",
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
		? "The user's most recent message is in Chinese. Reply in Chinese, and ensure all titles, summaries, section labels, and suggestions are also in Chinese."
		: "The user's most recent message is in English. Reply in English, and ensure all titles, summaries, section labels, and suggestions are also in English.";
}

function shouldEscalateToDeepAnalysis(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.message.includes("Recursion limit")
		|| error.message.includes("tool")
		|| error.message.includes("Agent returned no final message");
}

function extractStructuredAnswer(rawText: string, locale: ReviewLocale): ReviewStructuredAnswer {
	const match = rawText.match(/<deplens_json>\s*([\s\S]*?)\s*<\/deplens_json>/i);
	if (!match || !match[1]) {
		return sanitizeStructuredAnswer(buildFallbackStructuredAnswer(rawText, locale), locale);
	}

	try {
		const parsed = JSON.parse(match[1]) as ReviewStructuredAnswer;
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sections) || typeof parsed.title !== "string") {
			return sanitizeStructuredAnswer(buildFallbackStructuredAnswer(rawText, locale), locale);
		}
		return sanitizeStructuredAnswer(parsed, locale);
	} catch {
		return sanitizeStructuredAnswer(buildFallbackStructuredAnswer(rawText, locale), locale);
	}
}

function localizeCommonLabel(text: string): string {
	return text;
}

function sanitizeAdviceText(text: string): string {
	let next = text.trim();

	next = next
		.replace(/`deplens\s+unused\s+<package-name>`/gi, "provide the dependency or package name for a targeted review")
		.replace(/`deplens\s+unused\s+[^`]+`/gi, "provide the dependency or package name for a targeted review")
		.replace(/`deplens\s+review\s+--all`/gi, "continue reviewing all low-confidence dependency candidates")
		.replace(/`deplens\s+check\s+--fix`/gi, "this version does not provide auto-fix; verify manually before making changes")
		.replace(/`[^`]*deplens[^`]*`/gi, "a Deplens review step");

	if (/\b(npm|pnpm|npx|deplens)\b/i.test(next) || /\b(run|execute|call|invoke)\b/i.test(next)) {
		if (/\b(context|snippet|config|code)\b/i.test(next)) {
			return "Continue by checking the relevant dependency context, config snippets, and code snippets.";
		}
		if (/\b(candidate|review|indirect|tooling|config)\b/i.test(next)) {
			return "Continue by reviewing the low-confidence candidates, especially possible tooling, config, or indirect usage.";
		}
		if (/\b(package|dependency|declaration|reference)\b/i.test(next)) {
			return "Provide a dependency name or package name to continue with a more focused declaration, reference, and context review.";
		}
		return "* The suggestion has been blocked because it involves sensitive operations *";
	}

	return next;
}

function sanitizeStructuredAnswer(answer: ReviewStructuredAnswer, locale: ReviewLocale): ReviewStructuredAnswer {
	const nextAnswer: ReviewStructuredAnswer = {
		title: localizeCommonLabel(answer.title),
		type: answer.type,
		locale: answer.locale === "zh" || answer.locale === "en" ? answer.locale : locale,
		sections: answer.sections.map((section) => {
			const nextSection: typeof section = {
				type: section.type,
			};

			if (section.title !== undefined) {
				nextSection.title = localizeCommonLabel(section.title);
			}
			if (section.body !== undefined) {
				nextSection.body = section.body;
			}
			if (section.items !== undefined) {
				nextSection.items = section.items.map((item) => item);
			}
			if (section.pairs !== undefined) {
				nextSection.pairs = section.pairs.map((pair) => ({
					key: localizeCommonLabel(pair.key),
					value: pair.value,
				}));
			}
			if (section.language !== undefined) {
				nextSection.language = section.language;
			}
			if (section.code !== undefined) {
				nextSection.code = section.code;
			}

			return nextSection;
		}),
	};

	if (answer.summary !== undefined) {
		nextAnswer.summary = answer.summary;
	}
	if (answer.suggestions !== undefined) {
		nextAnswer.suggestions = answer.suggestions.map((item) => sanitizeAdviceText(item));
	}

	return nextAnswer;
}

function buildDeepAnalysisPrompt(report: AnalysisReport, question: string): string {
	return [
		"Use the full cached analysis report below to answer the question.",
		"You may reason more deeply here because the normal tool route was not sufficient.",
		"Still obey the same structured output schema and wrap the final JSON in <deplens_json> markers.",
		"",
		`Question: ${question}`,
		"",
		"Full report:",
		JSON.stringify(report, null, 2),
	].join("\n");
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
	let statusListener: ReviewStatusListener | null = null;
	const agent = createAgent({
		model,
		tools: createReviewTools(report, enhancement, (status) => statusListener?.(status)),
		systemPrompt: SYSTEM_PROMPT,
	});
	let messageHistory: Array<{ role: string; content: string } | Record<string, unknown>> = [];

	return {
		report,
		preparation: enhancement.summary,
		async ask(question: string): Promise<ReviewStructuredAnswer> {
			const locale = detectQuestionLocale(question);
			try {
				const result = await agent.invoke({
					messages: [
						...messageHistory,
						{ role: "system", content: buildLanguageInstruction(locale) },
						{ role: "user", content: question },
					],
					recursionLimit: 12,
				});
				messageHistory = result.messages;
				return extractStructuredAnswer(extractFinalText(result), locale);
			} catch (error) {
				if (shouldEscalateToDeepAnalysis(error)) {
					throw new ReviewFallbackRequiredError(
						question,
						"The current tool route could not answer this reliably. Deep analysis can use the full report and evidence, but it may consume many tokens."
					);
				}
				throw error;
			}
		},
		async deepAsk(question: string): Promise<ReviewStructuredAnswer> {
			const locale = detectQuestionLocale(question);
			const response = await model.invoke([
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "system", content: buildLanguageInstruction(locale) },
				{ role: "user", content: buildDeepAnalysisPrompt(report, question) },
			] as any);
			const rawText = typeof response.content === "string"
				? response.content
				: JSON.stringify(response.content);
			return extractStructuredAnswer(rawText, locale);
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
