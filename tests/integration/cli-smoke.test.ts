import path from "path";
import { AnalysisReport } from "../../src/types";
import { fixturePath } from "../helpers/fixtures";
import { runDeplensCli } from "../helpers/run-cli";

/**
 * 默认的 `check --json` 必须带上完整证据链：JSON 报告是给 CI 和外部工具消费的，
 * 旧行为只在 --review 时收集证据，导致默认报告里所有证据数组都是空的。
 */
function expectPopulatedEvidence(report: AnalysisReport): void {
	if (report.kind === "project") {
		expect(report.evidence.declarations.length).toBeGreaterThan(0);
		expect(report.evidence.issues.length).toBeGreaterThan(0);
		return;
	}

	expect(report.evidenceIndex.declarations.length).toBeGreaterThan(0);
	expect(report.evidenceIndex.packages).toEqual(
		report.packages.map((pkg) => pkg.name).sort((a, b) => a.localeCompare(b))
	);
}

/**
 * 证据条目里的路径必须是相对包根的，只有报告顶层的 path/projectPath 才是绝对路径。
 * 否则 JSON 报告无法在机器之间比对，也会泄漏本机目录结构。
 */
function expectPortableEvidencePaths(report: AnalysisReport): void {
	const isRelative = (filePath: string) =>
		!path.isAbsolute(filePath) && !/^[a-zA-Z]:/.test(filePath);
	const chains = report.kind === "project"
		? [report.evidence]
		: report.packages.map((pkg) => pkg.evidence);

	for (const chain of chains) {
		for (const reference of chain.references) {
			expect(isRelative(reference.filePath)).toBe(true);
		}
		for (const signal of chain.signals) {
			expect(isRelative(signal.filePath)).toBe(true);
		}
	}
}

describe("CLI smoke tests", () => {
	jest.setTimeout(30000);

	it.each([
		"single-npm-basic",
		"single-tooling-signals",
		"npm-transitive-requirements",
		"pnpm-monorepo-basic",
	])("prints JSON analysis for %s", async (fixtureName) => {
		const result = await runDeplensCli([
			"check",
			"--json",
			"-p",
			fixturePath(fixtureName),
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expectPopulatedEvidence(JSON.parse(result.stdout) as AnalysisReport);
		expectPortableEvidencePaths(JSON.parse(result.stdout) as AnalysisReport);
	});

	it("keeps a transitively required declaration visible instead of hiding it", async () => {
		const result = await runDeplensCli([
			"check",
			"--json",
			"-p",
			fixturePath("npm-transitive-requirements"),
		]);
		const report = JSON.parse(result.stdout) as AnalysisReport;

		expect(report.kind).toBe("project");
		if (report.kind !== "project") return;

		const byName = new Map(report.summary.unusedDependencies.map((item) => [item.name, item]));
		// `ms` 只被 debug 依赖、源码从未引用：旧实现会把它整个排除出分析，永远不报。
		expect(byName.get("ms")?.unusedClass).toBe("unused-still-installed");
		// `react` 被 react-dom 以 peerDependencies 要求，必须保留声明。
		expect(byName.get("react")?.unusedClass).toBe("keep-peer-requirement");
		expect(report.summary.totalDependencies).toBe(6);
	});

	it("omits review hints when --review is not enabled", async () => {
		const result = await runDeplensCli([
			"check",
			"-p",
			fixturePath("single-tooling-signals"),
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Check Results:");
		expect(result.stdout).not.toContain("Review Hints:");
		expect(result.stdout).not.toContain("low-confidence dependency candidates");
	});

	it("exposes --review on the check command", async () => {
		const result = await runDeplensCli(["check", "--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("--review");
		expect(result.stdout).toContain("--review-provider");
		expect(result.stdout).not.toContain("--preReview");
	});

	it("rejects an unknown review provider", async () => {
		const result = await runDeplensCli(["check", "--review", "--review-provider", "unknown"]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("llm");
		expect(result.stderr).toContain("jev");
	});

	it("requires review when a provider is explicitly selected", async () => {
		const result = await runDeplensCli(["check", "--review-provider", "jev"]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("review");
	});

	it("keeps JSON review output static when Jev is explicitly selected", async () => {
		const result = await runDeplensCli(["check", "--review", "--review-provider", "jev", "--json", "-p", fixturePath("single-tooling-signals")]);
		expect(result.code).toBe(0);
		expect(result.stderr).toContain("AI review is not included in JSON output");
		expectPopulatedEvidence(JSON.parse(result.stdout) as AnalysisReport);
	});

	it("exposes chat as the interactive command", async () => {
		const result = await runDeplensCli(["chat", "--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("deplens chat [question]");
		expect(result.stdout).toContain("--review");
		expect(result.stdout).not.toContain("--preReview");
	});
});
