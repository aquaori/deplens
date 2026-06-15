import fs from "fs";
import path from "path";
import { AnalysisReport } from "../../src/types";
import { fixturePath } from "../helpers/fixtures";
import { normalizeReport } from "../helpers/normalize";
import { runDeplensCli } from "../helpers/run-cli";

function readExpected(fixtureName: string) {
	return JSON.parse(
		fs.readFileSync(path.join(fixturePath(fixtureName), "expected.json"), "utf-8")
	);
}

describe("CLI smoke tests", () => {
	jest.setTimeout(30000);

	it.each([
		"single-npm-basic",
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
		expect(normalizeReport(JSON.parse(result.stdout) as AnalysisReport)).toEqual(
			readExpected(fixtureName)
		);
	});
});
