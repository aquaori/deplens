jest.mock("@langchain/openai", () => {
	const responses = [
		{ content: '{"action":"finalize_review","reason":"current evidence is enough for a conservative verdict"}' },
		{ content: '{"verdict":"likely-tooling-usage","confidence":"medium","reason":"signals suggest tooling usage","evidenceIds":[]}' },
		{ content: '{"action":"finalize_review","reason":"current evidence is enough for a conservative verdict"}' },
		{ content: '{"verdict":"likely-tooling-usage","confidence":"medium","reason":"signals suggest tooling usage","evidenceIds":[]}' },
		{ content: '{"action":"finalize_review","reason":"current evidence is enough for a conservative verdict"}' },
		{ content: '{"verdict":"needs-review","confidence":"low","reason":"evidence is still mixed","evidenceIds":[]}' },
	];

	return {
		ChatOpenAI: jest.fn().mockImplementation(() => ({
			invoke: jest.fn(async () => responses.shift()),
		})),
	};
});

import { analyzeProject } from "../../src/analyzer";
import { prepareReviewEnhancement } from "../../src/agent/base";
import { createAnalyzeArgs } from "../helpers/args";
import { fixturePath } from "../helpers/fixtures";

describe("second-pass review enhancement integration", () => {
	beforeAll(() => {
		process.env.QWEN_MODEL = "mock-model";
		process.env.QWEN_API_KEY = "mock-key";
		process.env.QWEN_BASE_URL = "http://localhost/mock";
	});

	it("reclassifies tooling-style unused candidates through the local investigation workflow", async () => {
		const report = await analyzeProject(
			createAnalyzeArgs(fixturePath("single-tooling-signals"), { review: true }),
			false
		);
		const enhancement = await prepareReviewEnhancement(report);

		expect(enhancement.summary.reviewedCandidateCount).toBeGreaterThan(0);
		expect(enhancement.summary.likelyToolingUsageCount).toBeGreaterThan(0);
		expect(
			Array.from(enhancement.reviewedByKey.values()).some((candidate) => candidate.reviewedByAgent)
		).toBe(true);
	});
});
