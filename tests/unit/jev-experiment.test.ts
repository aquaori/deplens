import fs from "fs";
import os from "os";
import path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { createLlmDecisionProvider } from "../../src/agent/review-decisions";
import { reviewCandidateWithWorkflow } from "../../src/agent/review-workflow";
import { runJevExperiment } from "../../scripts/jev-experiment";

// Test routing and report semantics without loading .env or calling either API.
jest.mock("../../src/config/runtime", () => ({ initializeRuntimeEnv: jest.fn() }));
jest.mock("@langchain/openai", () => ({ ChatOpenAI: jest.fn(() => ({})) }));
jest.mock("@typesafe-ai/sdk", () => ({ TypeSafeClient: jest.fn(() => ({ systemOne: jest.fn() })) }));
jest.mock("../../src/agent/review-decisions", () => ({
	createJevDecisionProvider: jest.fn(() => ({ provider: "jev" })),
	createLlmDecisionProvider: jest.fn(() => ({ provider: "llm" })),
}));
jest.mock("../../src/agent/review-workflow", () => ({
	reviewCandidateWithWorkflow: jest.fn(async (_report, provider, candidate) => ({ candidate: { ...candidate,
		disposition: "needs-review", reviewDecision: { provider: provider.provider, elapsedMs: 1, callCount: 1, inputTokens: 1, outputTokens: 1 } } })),
	buildRemovalAssessmentFromCandidate: jest.fn(() => ({ recommended: false })),
}));

describe("Jev experiment provider selection", () => {
	const keys = ["TYPESAFE_API_KEY", "JEV_API_KEY", "QWEN_MODEL", "QWEN_BASE_URL", "QWEN_API_KEY"];
	let output: string;
	let original: Record<string, string | undefined>;
	beforeEach(() => {
		jest.clearAllMocks();
		original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		for (const key of keys) delete process.env[key];
		process.env["TYPESAFE_API_KEY"] = "fake-jev";
		output = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-experiment-test-"));
		jest.spyOn(process.stdout, "write").mockImplementation(() => true);
	});
	afterEach(() => {
		for (const key of keys) {
			if (original[key] === undefined) delete process.env[key];
			else process.env[key] = original[key];
		}
		jest.restoreAllMocks();
		fs.rmSync(output, { recursive: true, force: true });
	});
	function report() { return JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8")); }

	it("defaults to Jev only without QWEN and does not construct or invoke an LLM", async () => {
		await runJevExperiment([`--output=${output}`]);
		const result = report();
		expect(result.status).toBe("completed");
		expect(result.missing).toEqual([]);
		expect(result.providers).toEqual(["jev"]);
		expect(result.rows).toHaveLength(120);
		expect(result.rows.every((row: any) => row.provider === "jev")).toBe(true);
		expect(ChatOpenAI).not.toHaveBeenCalled();
		expect(createLlmDecisionProvider).not.toHaveBeenCalled();
		expect(jest.mocked(reviewCandidateWithWorkflow).mock.calls.every((call) => (call[1] as any).provider === "jev")).toBe(true);
		expect(result.summaries.llm).toBeNull();
		expect(result.comparisonPerformed).toBe(false);
		expect(result.retentionCriteria.complete).toBe(true);
		expect(result.retentionCriteria.macroF1NotLower).toBeNull();
		expect(result.retentionCriteria.p50AtLeastTwiceAsFast).toBeNull();
		expect(result.passes).toBeNull();
		expect(result.summaries.jev.byExpected["confirmed-used"]).toMatchObject({ runs: 30, correct: 0, needsReview: 30, wrongDeterminate: 0 });
	});

	it("checks QWEN only for an explicitly requested comparison", async () => {
		await runJevExperiment(["--compare-llm", `--output=${output}`]);
		expect(report().status).toBe("blocked-missing-config");
		expect(report().missing).toEqual(["QWEN_MODEL", "QWEN_BASE_URL", "QWEN_API_KEY"]);
		expect(reviewCandidateWithWorkflow).not.toHaveBeenCalled();
		expect(ChatOpenAI).not.toHaveBeenCalled();
	});

	it("measures the separately labelled holdout without constructing an LLM", async () => {
		await runJevExperiment(["--holdout", `--output=${output}`]);
		const result = report();
		expect(result.corpus).toBe("holdout");
		expect(result.caseCount).toBe(12);
		expect(result.rows).toHaveLength(36);
		expect(result.retentionCriteria.complete).toBe(true);
		expect(result.stability).toHaveLength(6);
		expect(result.summaries.jev.byExpected["confirmed-used"].runs).toBe(9);
		expect(ChatOpenAI).not.toHaveBeenCalled();
	});

	it("runs both providers and retains comparison gates when explicitly enabled", async () => {
		process.env["QWEN_MODEL"] = "fake-model";
		process.env["QWEN_API_KEY"] = "fake-llm";
		process.env["QWEN_BASE_URL"] = "https://example.invalid";
		await runJevExperiment(["--compare-llm", `--output=${output}`]);
		const result = report();
		expect(result.status).toBe("completed");
		expect(result.comparisonPerformed).toBe(true);
		expect(result.rows).toHaveLength(240);
		expect(result.summaries.llm.completed).toBe(120);
		expect(result.summaries.jev.completed).toBe(120);
		expect(result.retentionCriteria.complete).toBe(true);
		expect(typeof result.retentionCriteria.macroF1NotLower).toBe("boolean");
		expect(typeof result.passes).toBe("boolean");
		expect(ChatOpenAI).toHaveBeenCalledTimes(1);
	});
});
