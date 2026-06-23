import fs from "fs";
import path from "path";
import { analyzeProject } from "../../src/analyzer";
import { AnalysisReport } from "../../src/types";
import { createAnalyzeArgs } from "../helpers/args";
import { fixturePath } from "../helpers/fixtures";
import { normalizeReport } from "../helpers/normalize";

function readExpected(fixtureName: string) {
	return JSON.parse(
		fs.readFileSync(path.join(fixturePath(fixtureName), "expected.json"), "utf-8")
	);
}

describe("analyzeProject integration fixtures", () => {
	jest.setTimeout(30000);

	it.each([
		"single-npm-basic",
		"single-pnpm-basic",
		"single-tooling-signals",
		"pnpm-monorepo-basic",
	])("matches normalized expected output for %s", async (fixtureName) => {
		const report = await analyzeProject(createAnalyzeArgs(fixturePath(fixtureName)), false);

		expect(Array.isArray(report)).toBe(false);
		expect(normalizeReport(report as AnalysisReport)).toEqual(readExpected(fixtureName));
	});

	it("can skip evidence collection for static-only analysis", async () => {
		const report = await analyzeProject(
			createAnalyzeArgs(fixturePath("single-tooling-signals")),
			false,
			false
		);

		expect(Array.isArray(report)).toBe(false);
		expect((report as AnalysisReport).kind).toBe("project");
		if (!Array.isArray(report) && report.kind === "project") {
			expect(report.evidence).toEqual({
				declarations: [],
				references: [],
				issues: [],
				signals: [],
			});
		}
	});
});
