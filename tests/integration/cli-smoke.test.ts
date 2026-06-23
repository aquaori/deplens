import { AnalysisReport } from "../../src/types";
import { fixturePath } from "../helpers/fixtures";
import { runDeplensCli } from "../helpers/run-cli";

function expectEmptyEvidence(report: AnalysisReport): void {
	if (report.kind === "project") {
		expect(report.evidence).toEqual({
			declarations: [],
			references: [],
			issues: [],
			signals: [],
		});
		return;
	}

	expect(report.packages.every((pkg) =>
		pkg.evidence.declarations.length === 0
		&& pkg.evidence.references.length === 0
		&& pkg.evidence.issues.length === 0
		&& pkg.evidence.signals.length === 0
	)).toBe(true);
	expect(report.evidenceIndex).toEqual({
		packages: report.packages.map((pkg) => pkg.name).sort((a, b) => a.localeCompare(b)),
		declarations: [],
		references: [],
		issues: [],
		signals: [],
		declarationsByDependency: {},
		referencesByDependency: {},
		issuesByDependency: {},
		signalsByDependency: {},
		declarationsByPackage: {},
		referencesByPackage: {},
		issuesByPackage: {},
		signalsByPackage: {},
	});
}

describe("CLI smoke tests", () => {
	jest.setTimeout(30000);

	it.each([
		"single-npm-basic",
		"single-tooling-signals",
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
		expectEmptyEvidence(JSON.parse(result.stdout) as AnalysisReport);
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
		expect(result.stdout).not.toContain("--preReview");
	});

	it("exposes chat as the interactive command", async () => {
		const result = await runDeplensCli(["chat", "--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("deplens chat [question]");
		expect(result.stdout).toContain("--review");
		expect(result.stdout).not.toContain("--preReview");
	});
});
