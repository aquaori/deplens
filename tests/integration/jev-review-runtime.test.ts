jest.mock("@langchain/openai", () => ({ ChatOpenAI: jest.fn(() => { throw new Error("LLM must not be constructed for Jev pre-review"); }) }));
jest.mock("@typesafe-ai/sdk", () => {
	const actual = jest.requireActual("@typesafe-ai/sdk");
	return { ...actual, TypeSafeClient: jest.fn(() => ({ systemOne: jest.fn(async () => { throw new Error("API unavailable"); }) })) };
});

import fs from "fs";
import os from "os";
import path from "path";
import { ChatOpenAI } from "@langchain/openai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { ensureReviewDecisionConfig, prepareReviewEnhancement, createReviewRuntime } from "../../src/agent/base";
import { createJevReviewCase } from "../helpers/jev-review-case";
import { readAgentProjectConfig } from "../../src/config/project";
import { readRunSummaryStore } from "../../src/agent/telemetry";
import type { MonorepoAnalysisReport } from "../../src/types";
import { buildMonorepoEvidenceIndex } from "../../src/evidence";

describe("Jev pre-review runtime", () => {
	let tempDir: string;
	const keys = ["QWEN_API_KEY", "QWEN_BASE_URL", "QWEN_MODEL", "TYPESAFE_API_KEY", "JEV_API_KEY"];
	let original: Array<string | undefined>;
	beforeEach(() => {
		original = keys.map((key) => process.env[key]);
		keys.forEach((key) => { delete process.env[key]; });
		process.env["TYPESAFE_API_KEY"] = "fake-typesafe";
		process.env["JEV_API_KEY"] = "fake-alias";
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-jev-runtime-"));
		fs.writeFileSync(path.join(tempDir, "deplens.config.json"), JSON.stringify({ agent: { review: { provider: "jev" }, memory: { enabled: false } } }));
		jest.clearAllMocks();
	});
	afterEach(() => {
		keys.forEach((key, index) => { const value = original[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; });
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("requires only Jev configuration, downgrades failed candidates and records the actual failure", async () => {
		const { report } = createJevReviewCase(tempDir);
		expect(readAgentProjectConfig(tempDir).review.provider).toBe("jev");
		expect(() => ensureReviewDecisionConfig(report)).not.toThrow();
		const result = await prepareReviewEnhancement(report);
		expect(result.summary.needsReviewCount).toBe(1);
		expect(ChatOpenAI).not.toHaveBeenCalled();
		expect(TypeSafeClient).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "fake-typesafe", defaultModel: "jev-1.13.0", timeout: 10000, retry: { maxRetries: 0 } }));
		const candidate = Array.from(result.reviewedByKey.values())[0]!;
		expect(candidate.reviewParseStatus).toBeUndefined();
		expect(candidate.reviewDecision?.fallbackReason).toBe("api-error");
		expect(readRunSummaryStore(tempDir).entries[0]?.decision?.fallbackReason).toBe("api-error");
	});

	it("continues reviewing monorepo packages with the same dependency name after a failure", async () => {
		const packages = ["a", "b"].map((name) => {
			const { report } = createJevReviewCase(path.join(tempDir, name), undefined, name);
			return { name, path: report.path, summary: report.summary, usedImports: [], declaredDependencies: ["tooling-lib"], removableDependencies: [], dynamicImports: [], unusedDependencies: ["tooling-lib"], ghostDependencies: [], workspaceDependencies: [], undeclaredWorkspaceDependencies: [], evidence: report.evidence };
		});
		const report: MonorepoAnalysisReport = {
			kind: "monorepo", projectPath: tempDir, monorepoType: "pnpm", packages,
			packageCount: 2, packagesWithUnusedDependencies: 2, packagesWithGhostDependencies: 0, packagesWithoutUnusedDependencies: 0,
			evidenceIndex: buildMonorepoEvidenceIndex(packages),
		};
		const result = await prepareReviewEnhancement(report);
		expect(result.reviewedByKey.size).toBe(2);
		expect(result.reviewedByKey.has("a::tooling-lib")).toBe(true);
		expect(result.reviewedByKey.has("b::tooling-lib")).toBe(true);
	});

	it("still requires LLM configuration for chat", () => {
		const { report } = createJevReviewCase(tempDir);
		expect(() => createReviewRuntime(report)).toThrow(/QWEN/);
	});

	it("accepts the key alias and rejects absent credentials", () => {
		const { report } = createJevReviewCase(tempDir);
		delete process.env["TYPESAFE_API_KEY"];
		expect(() => ensureReviewDecisionConfig(report)).not.toThrow();
		delete process.env["JEV_API_KEY"];
		expect(() => ensureReviewDecisionConfig(report)).toThrow(/TYPESAFE_API_KEY/);
	});
});
