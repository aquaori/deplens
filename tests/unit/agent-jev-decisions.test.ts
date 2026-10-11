import fs from "fs";
import os from "os";
import path from "path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createJevDecisionProvider, validateChoiceAnswer, type ReviewDecisionInput } from "../../src/agent/review-decisions";
import { reviewCandidateWithWorkflow, buildRemovalAssessmentFromCandidate } from "../../src/agent/review-workflow";
import { getDefaultAgentProjectConfig } from "../../src/config/project";
import { getDependencyOverview, getDependencyContextBundle } from "../../src/query";
import { createJevReviewCase, JEV_CASES } from "../helpers/jev-review-case";
import { fuseReviewConfidence } from "../../src/agent/confidence-fusion";

function answer(criteria: Record<string, unknown>, selected: string, peak = 1) {
	const labels = Object.keys(criteria);
	return { type: "choice", choice: selected, confidence: (peak - 1 / labels.length) / (1 - 1 / labels.length),
		probabilities: Object.fromEntries(labels.map((label) => [label, label === selected ? peak : (1 - peak) / (labels.length - 1)])) };
}

describe("Jev review decisions", () => {
	let projectPath: string;
	beforeEach(() => { projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-jev-")); });
	afterEach(() => { fs.rmSync(projectPath, { recursive: true, force: true }); });

	function setup(testCase = JEV_CASES[0]!, mutate?: (request: any, response: any) => any) {
		const { report, candidate } = createJevReviewCase(projectPath, testCase);
		const fetchMock = jest.fn(async (_url: unknown, init: any) => {
			const request = JSON.parse(init.body);
			const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]: [string, any]) => {
				const selected = id === "action"
					? Object.keys(question.criteria).find((name) => name !== "finalize_review") || "finalize_review"
					: id === "verdict" ? testCase.expected
					: request.state.includes("irrelevant") ? "irrelevant" : (testCase.category === "tooling" ? "tooling_usage" : testCase.category === "runtime" ? "runtime_usage" : testCase.category === "unused" ? "unused_support" : "irrelevant");
				return [id, answer(question.criteria, selected)];
			}));
			const body = mutate ? mutate(request, { model: "jev-1.13.0", answers, usage: { input_tokens: 123, output_tokens: 7 } }) : { model: "jev-1.13.0", answers, usage: { input_tokens: 123, output_tokens: 7 } };
			return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
		});
		const client = new TypeSafeClient({ apiKey: "fake", fetch: fetchMock, retry: { maxRetries: 0 }, logLevel: "off" });
		const provider = createJevDecisionProvider(client);
		const overview = getDependencyOverview(report, candidate.dependencyName);
		const contextBundle = getDependencyContextBundle(report, candidate.dependencyName);
		const config = getDefaultAgentProjectConfig();
		const options = { memoryEnabled: false, memoryMaxEntries: 10, review: config.review, telemetry: { enabled: false, maxRuns: 10 } };
		return { report, candidate, provider, overview, contextBundle, options, fetchMock };
	}

	async function run(s: ReturnType<typeof setup>, onStatus = jest.fn()) {
		return reviewCandidateWithWorkflow(s.report, s.provider, s.candidate, s.overview, s.contextBundle, s.options, undefined, onStatus);
	}

	it("uses native probabilities, classifies evidence, avoids repeats and counts calls", async () => {
		const s = setup();
		const result = await run(s);
		expect(result.candidate.disposition).toBe("likely-tooling-usage");
		expect(result.candidate.reviewDecision).toMatchObject({ provider: "jev", model: "jev-1.13.0", confidence: 1 });
		expect(result.candidate.reviewDecision?.fallbackReason).toBeUndefined();
		expect(result.candidate.reviewDecision?.inputTokens).toBe(s.fetchMock.mock.calls.length * 123);
		expect(result.candidate.reviewParseStatus).toBeUndefined();
		expect(result.candidate.reviewEvidenceIds).toContain("signal:tooling-lib");
		expect(result.candidate.reviewEvidenceIds).not.toContain("decl:tooling-lib");
		expect(result.candidate.reviewEvidenceIds).not.toContain("issue:tooling-lib");
		const actions = s.fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body)).filter((request) => request.questions.action);
		const states = actions.map((request) => JSON.parse(request.state));
		for (const state of states) expect(new Set(state.history).size).toBe(state.history.length);
		expect(s.fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
	});

	it.each(["unknown-option", "missing-answer", "nan", "bad-sum", "wrong-confidence"])("rejects %s and returns needs-review", async (failure) => {
		const s = setup(JEV_CASES[0], (_request, response) => {
			const action = response.answers.action;
			if (failure === "unknown-option") action.choice = "delete_dependency";
			if (failure === "missing-answer") response.answers = {};
			if (failure === "nan") action.probabilities.inspect_scripts = null;
			if (failure === "bad-sum") action.probabilities.inspect_scripts = 0.3;
			if (failure === "wrong-confidence") action.confidence = 0;
			return response;
		});
		const status = jest.fn();
		const result = await run(s, status);
		expect(result.candidate.disposition).toBe("needs-review");
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("invalid-response");
		expect(buildRemovalAssessmentFromCandidate(result.candidate).recommended).toBe(false);
		expect(s.fetchMock).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenLastCalledWith(null);
	});

	it("rejects nonfinite probabilities before they enter fusion", () => {
		expect(() => validateChoiceAnswer({ type: "choice", choice: "a", confidence: 1, probabilities: { a: Infinity, b: 0 } }, { a: "A", b: "B" })).toThrow("invalid-response");
	});

	it("accepts the live API's two-decimal rounding", () => {
		const criteria = { scripts: "scripts", code: "code", knowledge: "knowledge", summary: "summary", finalize: "finalize" };
		expect(validateChoiceAnswer({ type: "choice", choice: "scripts", confidence: 0.71, probabilities: { scripts: 0.77, code: 0.12, knowledge: 0.01, summary: 0.1, finalize: 0 } }, criteria).choice).toBe("scripts");
		expect(validateChoiceAnswer({ type: "choice", choice: "scripts", confidence: 0.8, probabilities: { scripts: 0.84, code: 0.04, knowledge: 0.04, summary: 0.04, finalize: 0.03 } }, criteria).choice).toBe("scripts");
	});

	it("stops on low action confidence without calling another model", async () => {
		const s = setup(JEV_CASES[0], (request, response) => ({ ...response, answers: { action: answer(request.questions.action.criteria, "inspect_scripts", 0.3) } }));
		const result = await run(s);
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("low-confidence");
		expect(s.fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(["rate-limit", "timeout"])("isolates %s and clears status", async (failure) => {
		const s = setup();
		s.fetchMock.mockImplementation(async () => {
			if (failure === "timeout") throw new Error("connection timeout");
			return new Response('{"error":"rate limited"}', { status: 429 });
		});
		const status = jest.fn();
		const result = await run(s, status);
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("api-error");
		expect(result.candidate.disposition).toBe("needs-review");
		expect(s.fetchMock).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenLastCalledWith(null);
	});

	it("requires inspection when the model finalizes early", async () => {
		const s = setup(JEV_CASES[0], (request, response) => {
			if (request.questions.action) response.answers.action = answer(request.questions.action.criteria, "finalize_review");
			return response;
		});
		const result = await run(s);
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("insufficient-evidence");
		expect(result.candidate.disposition).toBe("needs-review");
	});

	it("keeps round exhaustion conservative even if the verdict has supporting evidence", async () => {
		const s = setup();
		s.options.review = { ...s.options.review, maxRounds: 1 };
		const result = await run(s);
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("unresolved-gaps");
	});

	it("protects direct references against a deletion recommendation", async () => {
		const s = setup(JEV_CASES[20]);
		s.candidate.isReferenced = true;
		s.overview.isReferenced = true;
		const result = await run(s);
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("business-conflict");
		expect(buildRemovalAssessmentFromCandidate(result.candidate).recommended).toBe(false);
	});

	it("rejects an unused verdict that contradicts another current usage record", async () => {
		const s = setup(JEV_CASES[20], (request, response) => {
			if (request.questions.verdict) response.answers.evidence_2 = answer(request.questions.evidence_2.criteria, "runtime_usage");
			return response;
		});
		expect((await run(s)).candidate.reviewDecision?.fallbackReason).toBe("business-conflict");
	});

	it("honors an SDK request timeout without retrying", async () => {
		const s = setup();
		const fetchMock = jest.fn((_url: unknown, init: any) => new Promise<Response>((_resolve, reject) => {
			init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
		}));
		s.provider = createJevDecisionProvider(new TypeSafeClient({ apiKey: "fake", timeout: 5, retry: { maxRetries: 0 }, fetch: fetchMock, logLevel: "off" }));
		const result = await run(s);
		expect(result.candidate.reviewDecision?.fallbackReason).toBe("api-error");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not treat declarations, issues, documentation or historical reviews as runtime proof", async () => {
		const s = setup(JEV_CASES[10]);
		const input: ReviewDecisionInput = { candidate: s.candidate, overview: s.overview, gaps: [], actionHistory: [], ledger: new Map([
			["decl:1", { id: "decl:1", sourceType: "declaration", kind: "fact", summary: "declared" }],
			["issue:1", { id: "issue:1", sourceType: "issue", kind: "fact", summary: "scanner opinion" }],
			["knowledge:1", { id: "knowledge:1", sourceType: "knowledge", kind: "claim", summary: "README says used" }],
			["memory:1", { id: "memory:1", sourceType: "memory", kind: "claim", summary: "past used verdict" }],
		]) };
		const result = await s.provider.decideVerdict(input, () => { throw new Error("LLM prompt must not be built"); });
		expect(result.metadata.fallbackReason).toBe("insufficient-evidence");
		const request = JSON.parse(s.fetchMock.mock.calls[0]![1].body);
		expect(request.state).not.toContain("memory:1");
		expect(Object.keys(request.questions)).toHaveLength(4);
	});

	it("rejects low-confidence verdicts and unsupported evidence classifications", async () => {
		for (const lowVerdict of [true, false]) {
			const s = setup(JEV_CASES[0], (request, response) => {
				if (!request.questions.verdict) return response;
				for (const [id, question] of Object.entries(request.questions) as [string, any][]) {
					if ((id === "verdict") === lowVerdict) response.answers[id] = answer(question.criteria, response.answers[id].choice, 0.5);
				}
				return response;
			});
			expect((await run(s)).candidate.reviewDecision?.fallbackReason).toBe(lowVerdict ? "low-confidence" : "insufficient-evidence");
		}
	});

	it("sends executable snippets and follows config investigation", async () => {
		const s = setup({ ...JEV_CASES[0]!, fileRole: "config", code: 'export default { plugins: ["tooling-lib"] };' });
		await run(s);
		const states = s.fetchMock.mock.calls.map(([, init]) => JSON.parse(JSON.parse(init.body).state));
		expect(states.some((state) => state.history.includes("inspect_config"))).toBe(true);
		expect(states.at(-1).evidence.some((record: any) => record.content?.includes("plugins"))).toBe(true);
	});

	it("uses the supplied probability distribution instead of three-band reconstruction", () => {
		const s = setup();
		const base = { candidate: s.candidate, modelVerdict: { verdict: "confirmed-used" as const, confidence: "high" as const, reason: "used", evidenceIds: ["ref:1", "ref:2"] }, validEvidenceIds: ["ref:1", "ref:2"], knowledgeHits: [], knowledgeEvidenceIds: [] };
		const old = fuseReviewConfidence(base);
		const native = fuseReviewConfidence({ ...base, modelDistribution: { "confirmed-used": 0.999, "likely-tooling-usage": 0.00025, "needs-review": 0.00025, "high-confidence-unused": 0.00025, "ghost-dependency": 0.00025 } });
		expect(native.distribution["confirmed-used"]).toBeGreaterThan(old.distribution["confirmed-used"]);
	});
});
