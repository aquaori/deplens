import { analyzePackage } from "../../src/analyzer";
import { createAnalyzeArgs } from "../helpers/args";
import { fixturePath } from "../helpers/fixtures";

describe("buildPackageEvidenceChain", () => {
	it("collects declarations, signals, and unused dependency issues", async () => {
		const analysis = await analyzePackage({
			args: createAnalyzeArgs(fixturePath("single-tooling-signals")),
			collectEvidence: true,
		});
		const evidence = analysis.evidence;

		expect(evidence.declarations.map((item) => item.dependencyName)).toEqual([
			"babel-plugin-macros",
			"eslint",
			"unused-tool",
		]);
		expect(evidence.references).toEqual([]);
		expect(evidence.signals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					dependencyName: "babel-plugin-macros",
					signalType: "require-resolve",
					fileRole: "config",
				}),
				expect.objectContaining({
					dependencyName: "eslint",
					signalType: "script-command",
					fileRole: "script",
				}),
			])
		);
		// eslint 通过 `"lint": "eslint ."` 被脚本调用，不应再被判为未使用。
		expect(evidence.issues.map((item) => `${item.dependencyName}:${item.issueType}`)).toEqual([
			"babel-plugin-macros:unused-dependency",
			"unused-tool:unused-dependency",
		]);
		expect(analysis.summary.unusedDependencies.map((item) => item.name)).not.toContain("eslint");
	});

	it("grades removal risk on every unused-dependency issue", async () => {
		const analysis = await analyzePackage({
			args: createAnalyzeArgs(fixturePath("single-tooling-signals")),
			collectEvidence: true,
		});

		for (const issue of analysis.evidence.issues) {
			if (issue.issueType !== "unused-dependency") continue;
			expect(issue.dependencyClass).toBeDefined();
		}
	});

	it("keeps evidence file paths relative to the analyzed package", async () => {
		const analysis = await analyzePackage({
			args: createAnalyzeArgs(fixturePath("single-tooling-signals")),
			collectEvidence: true,
		});

		for (const signal of analysis.evidence.signals) {
			expect(signal.filePath.startsWith("/")).toBe(false);
			expect(/^[a-zA-Z]:/.test(signal.filePath)).toBe(false);
		}
	});
});
