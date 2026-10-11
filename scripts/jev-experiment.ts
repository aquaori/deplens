import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { ChatOpenAI } from "@langchain/openai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { initializeRuntimeEnv } from "../src/config/runtime";
import { getDefaultAgentProjectConfig } from "../src/config/project";
import { createJevDecisionProvider, createLlmDecisionProvider, type ReviewDecisionProvider } from "../src/agent/review-decisions";
import { reviewCandidateWithWorkflow, buildRemovalAssessmentFromCandidate } from "../src/agent/review-workflow";
import { getDependencyContextBundle, getDependencyOverview } from "../src/query";
import { JEV_CASES, createJevReviewCase } from "../tests/helpers/jev-review-case";
import type { DependencyReviewDisposition, ReviewDecisionMetadata } from "../src/types";

interface Row {
	id: string; provider: "llm" | "jev"; round: number; language: string; expected: DependencyReviewDisposition;
	actual?: DependencyReviewDisposition; elapsedMs?: number; error?: string; unsafeRemoval?: boolean;
	decision?: ReviewDecisionMetadata;
}

const labels: DependencyReviewDisposition[] = ["confirmed-used", "likely-tooling-usage", "needs-review", "high-confidence-unused", "ghost-dependency"];
function percentile(values: number[], fraction: number): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.ceil(fraction * sorted.length) - 1]!;
}
function summarize(rows: Row[]) {
	const valid = rows.filter((row) => row.actual);
	const macroLabels = labels.filter((label) => rows.some((row) => row.expected === label));
	const macroF1 = macroLabels.reduce((sum, label) => {
		const tp = rows.filter((row) => row.actual === label && row.expected === label).length;
		const fp = rows.filter((row) => row.actual === label && row.expected !== label).length;
		const fn = rows.filter((row) => row.actual !== label && row.expected === label).length;
		return sum + (2 * tp / (2 * tp + fp + fn) || 0);
	}, 0) / macroLabels.length;
	const decisions = valid.map((row) => row.decision);
	const determinate = valid.filter((row) => row.actual !== "needs-review");
	return {
		runs: rows.length, completed: valid.length, errors: rows.length - valid.length, macroF1,
		needsReviewRate: valid.filter((row) => row.actual === "needs-review").length / rows.length,
		determinateCount: determinate.length,
		determinateAccuracy: determinate.length ? determinate.filter((row) => row.actual === row.expected).length / determinate.length : null,
		p50DeterminateMs: percentile(determinate.map((row) => row.elapsedMs!), 0.5),
		unsafeRemovalCount: rows.filter((row) => row.unsafeRemoval).length,
		p50Ms: percentile(valid.map((row) => row.elapsedMs!), 0.5), p95Ms: percentile(valid.map((row) => row.elapsedMs!), 0.95),
		calls: decisions.reduce((sum, item) => sum + (item?.callCount || 0), 0),
		inputTokens: decisions.reduce((sum, item) => sum + (item?.inputTokens || 0), 0),
		outputTokens: decisions.reduce((sum, item) => sum + (item?.outputTokens || 0), 0),
		fallbackCount: decisions.filter((item) => item?.fallbackReason).length,
		recoveredActionSelections: decisions.reduce((sum, item) => sum + (item?.actionDecisions?.filter((decision) => decision.selectedBy === "deterministic").length || 0), 0),
		byExpected: Object.fromEntries(macroLabels.map((label) => {
			const cases = rows.filter((row) => row.expected === label);
			const correct = cases.filter((row) => row.actual === label).length;
			return [label, { runs: cases.length, correct, recall: correct / cases.length,
				needsReview: cases.filter((row) => row.actual === "needs-review").length,
				wrongDeterminate: cases.filter((row) => row.actual && row.actual !== "needs-review" && row.actual !== label).length }];
		})),
	};
}

export async function runJevExperiment(args = process.argv.slice(2)) {
	initializeRuntimeEnv();
	const compareLlm = args.includes("--compare-llm");
	const selectedProviders: Row["provider"][] = compareLlm ? ["jev", "llm"] : ["jev"];
	const expectedReviews = JEV_CASES.length * 3 * selectedProviders.length;
	const outputArg = args.find((arg) => arg.startsWith("--output="));
	const output = path.resolve(outputArg?.slice("--output=".length) || ".deplens/jev-experiment");
	fs.mkdirSync(output, { recursive: true });
	const runId = crypto.randomUUID();
	const corpusHash = crypto.createHash("sha256").update(JSON.stringify(JEV_CASES)).digest("hex");
	const sourceFiles = ["src/agent/review-decisions.ts", "src/agent/review-coverage.ts", "src/agent/review-workflow.ts", "src/agent/confidence-fusion.ts", "src/config/project.ts", "scripts/jev-experiment.ts", "tests/helpers/jev-review-case.ts", "pnpm-lock.yaml"];
	const sourceHash = crypto.createHash("sha256").update(sourceFiles.map((file) => `${file}\n${fs.readFileSync(file, "utf8")}`).join("\n")).digest("hex");
	const missing: string[] = [];
	if (!process.env["TYPESAFE_API_KEY"]?.trim() && !process.env["JEV_API_KEY"]?.trim()) missing.push("TYPESAFE_API_KEY or JEV_API_KEY");
	if (compareLlm) for (const key of ["QWEN_MODEL", "QWEN_BASE_URL", "QWEN_API_KEY"]) if (!process.env[key]?.trim()) missing.push(key);
	const meta = { runId, createdAt: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		corpusHash, sourceHash, sourceFiles, node: process.version, platform: process.platform, caseCount: JEV_CASES.length, measuredRounds: 3, warmupRounds: 1, concurrency: 2,
		kind: "synthetic-review-replay", decisionDesign: "local-context-v5", positivePredicateThreshold: 0.9, negativeUsageThreshold: 0.1,
		memory: false, telemetry: false, timeoutMs: 10000, retries: 0, providers: selectedProviders, comparisonRequested: compareLlm };
	const rows: Row[] = [];
	let stability: Array<{ id: string; language: string; dispositions: DependencyReviewDisposition[]; stable: boolean; bothDeterminate: boolean; decisions: Array<ReviewDecisionMetadata | undefined> }> | null = null;
	function save(status: string, extra: Record<string, unknown> = {}) {
		const llm = compareLlm ? summarize(rows.filter((row) => row.provider === "llm")) : null;
		const jev = summarize(rows.filter((row) => row.provider === "jev"));
		const complete = rows.length === expectedReviews && jev.completed === JEV_CASES.length * 3
			&& (!llm || llm.completed === JEV_CASES.length * 3);
		const retentionCriteria = {
			complete, zeroUnsafeRemovals: jev.unsafeRemovalCount === 0,
			macroF1NotLower: llm ? complete && jev.macroF1 >= llm.macroF1 : null,
			needsReviewIncreaseWithin5pp: llm ? complete && jev.needsReviewRate <= llm.needsReviewRate + 0.05 : null,
			p50AtLeastTwiceAsFast: llm ? complete && jev.p50Ms! <= llm.p50Ms! * 0.5 : null,
			p95NotWorse: llm ? complete && jev.p95Ms! <= llm.p95Ms! : null,
			sampledOrderStability: stability !== null && stability.length === 6 && stability.every((check) => check.stable),
		};
		const cost = { jevEstimatedUsd: jev.inputTokens * 0.042 / 1_000_000, jevInputUsdPerMillionTokens: 0.042,
			llmEstimatedUsd: null, llmPricingNote: "Custom OpenAI-compatible endpoint pricing is not known; actual billed charges are not measured." };
		fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ ...meta, status, missing, comparisonPerformed: Boolean(llm?.completed), summaries: { llm, jev }, cost, retentionCriteria,
			passes: compareLlm ? complete && Object.values(retentionCriteria).every(Boolean) : null, stability, rows, ...extra }, null, 2));
	}
	if (missing.length) { save("blocked-missing-config"); process.stdout.write(`Experiment blocked: missing ${missing.join(", ")}. No keys printed.\n`); return; }
	const sdk = new TypeSafeClient({ apiKey: process.env["TYPESAFE_API_KEY"]?.trim() || process.env["JEV_API_KEY"]!.trim(),
		baseURL: process.env["TYPESAFE_BASE_URL"]?.trim() || "https://api.typesafe.ai", defaultModel: process.env["TYPESAFE_DEFAULT_MODEL"]?.trim() || "jev-1.13.0",
		timeout: 10000, retry: { maxRetries: 0 }, logLevel: "off" });
	const providers: Partial<Record<Row["provider"], ReviewDecisionProvider>> = { jev: createJevDecisionProvider(sdk) };
	if (compareLlm) {
		const model = new ChatOpenAI({ model: process.env["QWEN_MODEL"]!, apiKey: process.env["QWEN_API_KEY"]!,
			configuration: { baseURL: process.env["QWEN_BASE_URL"]! }, maxRetries: 0, timeout: 10000 });
		providers.llm = createLlmDecisionProvider(model);
	}
	const reordered = createJevDecisionProvider({ systemOne: (request, requestOptions) => sdk.systemOne({ ...request,
		questions: Object.fromEntries(Object.entries(request.questions).reverse().map(([id, question]) => [id,
			question.type === "choice" ? { ...question, criteria: Object.fromEntries(Object.entries(question.criteria).reverse()) } : question])) as typeof request.questions,
	}, requestOptions) });
	const config = getDefaultAgentProjectConfig();
	const options = { memoryEnabled: false, memoryMaxEntries: 1, review: config.review, telemetry: { enabled: false, maxRuns: 1 } };
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-jev-evaluation-"));
	const errors = new Map<string, number>();
	const disabled = new Set<string>();
	try {
		let cursor = 0;
		async function worker() {
			while (cursor < JEV_CASES.length) {
				const index = cursor++;
				const testCase = JEV_CASES[index]!;
				for (let round = -1; round < 3; round += 1) {
					const order: Row["provider"][] = compareLlm ? ((index + round) % 2 ? ["jev", "llm"] : ["llm", "jev"]) : ["jev"];
					for (const provider of order) {
						const row: Row = { id: testCase.id, provider, round, language: testCase.language, expected: testCase.expected };
						if (disabled.has(provider)) row.error = "provider-unavailable-after-three-consecutive-api-errors";
						else {
							const root = path.join(tempRoot, `${testCase.id}-${provider}-${round}`);
							const { report, candidate } = createJevReviewCase(root, testCase);
							const started = Date.now();
							try {
								const result = await reviewCandidateWithWorkflow(report, providers[provider]!, candidate,
									getDependencyOverview(report, candidate.dependencyName), getDependencyContextBundle(report, candidate.dependencyName), options,
									testCase.language === "zh" ? "这个依赖是否实际使用？" : "Is this dependency actually used?");
								row.elapsedMs = Date.now() - started;
								row.actual = result.candidate.disposition;
								if (result.candidate.reviewDecision) row.decision = result.candidate.reviewDecision;
								row.unsafeRemoval = buildRemovalAssessmentFromCandidate(result.candidate).recommended && testCase.expected !== "high-confidence-unused";
								if (result.candidate.reviewDecision?.fallbackReason === "api-error") errors.set(provider, (errors.get(provider) || 0) + 1);
								else errors.set(provider, 0);
							} catch {
								row.error = "api-or-workflow-error";
								row.elapsedMs = Date.now() - started;
								errors.set(provider, (errors.get(provider) || 0) + 1);
							}
							if ((errors.get(provider) || 0) >= 3) disabled.add(provider);
						}
						if (round >= 0) { rows.push(row); save("running"); }
					}
				}
				process.stdout.write(`Evaluated ${testCase.id}; ${rows.length}/${expectedReviews} measured reviews.\n`);
			}
		}
		save("running");
		await Promise.all([worker(), worker()]);
		if (!disabled.has("jev")) {
			const checks = [];
			for (const index of [0, 1, 18, 24, 30, 35]) {
				const testCase = JEV_CASES[index]!;
				const dispositions: DependencyReviewDisposition[] = [];
				const decisions: Array<ReviewDecisionMetadata | undefined> = [];
				for (const [order, provider] of [providers.jev!, reordered].entries()) {
					try {
						const { report, candidate } = createJevReviewCase(path.join(tempRoot, `stability-${testCase.id}-${order}`), testCase);
						const result = await reviewCandidateWithWorkflow(report, provider, candidate,
							getDependencyOverview(report, candidate.dependencyName), getDependencyContextBundle(report, candidate.dependencyName), options,
							testCase.language === "zh" ? "这个依赖是否实际使用？" : "Is this dependency actually used?");
						dispositions.push(result.candidate.disposition);
						decisions.push(result.candidate.reviewDecision);
					} catch { decisions.push(undefined); }
				}
				checks.push({ id: testCase.id, language: testCase.language, dispositions, decisions,
					stable: dispositions.length === 2 && dispositions[0] === dispositions[1] && decisions.every((decision) => decision && decision.fallbackReason !== "api-error" && decision.fallbackReason !== "invalid-response"),
					bothDeterminate: dispositions.length === 2 && dispositions.every((disposition) => disposition !== "needs-review") });
			}
			stability = checks;
		}
		save(disabled.size ? "incomplete-provider-unavailable" : "completed");
		process.stdout.write(`Report saved: ${path.join(output, "report.json")}\n`);
	} finally {
		if (!tempRoot.startsWith(path.join(os.tmpdir(), "deplens-jev-evaluation-"))) throw new Error("Unexpected temporary directory");
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

if (require.main === module) runJevExperiment().catch(() => {
	process.stderr.write("Experiment failed; inspect the saved partial report. No API error bodies or credentials logged.\n"); process.exitCode = 1;
});
