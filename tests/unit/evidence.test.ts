import { buildPackageEvidenceChain } from "../../src/evidence";
import { createAnalyzeArgs } from "../helpers/args";
import { fixturePath } from "../helpers/fixtures";

describe("buildPackageEvidenceChain", () => {
	it("collects declarations, signals, and unused dependency issues", async () => {
		const args = createAnalyzeArgs(fixturePath("single-tooling-signals"));
		const evidence = await buildPackageEvidenceChain({
			args,
			summary: {
				usedDependencies: 0,
				unusedDependencies: [
					{
						name: "babel-plugin-macros",
						type: "",
						version: {},
						usage: false,
						isDev: false,
					},
					{
						name: "eslint",
						type: "",
						version: {},
						usage: false,
						isDev: false,
					},
					{
						name: "unused-tool",
						type: "",
						version: {},
						usage: false,
						isDev: false,
					},
				],
				ununsedDependenciesCount: 3,
				totalDependencies: 3,
				devDependencies: [],
			},
		});

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
		expect(evidence.issues.map((item) => `${item.dependencyName}:${item.issueType}`)).toEqual([
			"babel-plugin-macros:unused-dependency",
			"eslint:unused-dependency",
			"unused-tool:unused-dependency",
		]);
	});
});
