import { getDisplayableUnusedDependencies } from "../../src/report/builders";
import {
	getDependencyReviewCandidate,
	getGhostDependencies,
	getPackageSummary,
	getUnusedDependencies,
} from "../../src/query";
import { SingleProjectAnalysisReport } from "../../src/types";

const report: SingleProjectAnalysisReport = {
	kind: "project",
	path: "/workspace/project",
	summary: {
		usedDependencies: 1,
		unusedDependencies: [
			{
				name: "unused-lib",
				type: "",
				version: {},
				usage: false,
				isDev: false,
			},
			{
				name: "tooling-lib",
				type: "",
				version: {},
				usage: false,
				isDev: false,
			},
			{
				name: "runtime-only",
				type: "dynamic",
				version: {},
				usage: false,
				isDev: false,
				args: "require(name)",
			},
		],
		ununsedDependenciesCount: 2,
		totalDependencies: 4,
		devDependencies: [],
	},
	evidence: {
		declarations: [
			{
				id: "project:decl:dependencies:used-lib",
				packageName: "project",
				dependencyName: "used-lib",
				manifestPath: "package.json",
				section: "dependencies",
				versionRange: "1.0.0",
			},
			{
				id: "project:decl:dependencies:unused-lib",
				packageName: "project",
				dependencyName: "unused-lib",
				manifestPath: "package.json",
				section: "dependencies",
				versionRange: "1.0.0",
			},
			{
				id: "project:decl:dependencies:tooling-lib",
				packageName: "project",
				dependencyName: "tooling-lib",
				manifestPath: "package.json",
				section: "dependencies",
				versionRange: "1.0.0",
			},
		],
		references: [
			{
				id: "project:ref:src/index.ts:1:1:used-lib",
				packageName: "project",
				dependencyName: "used-lib",
				filePath: "src/index.ts",
				line: 1,
				column: 1,
				kind: "import",
				specifier: "used-lib",
				isWorkspaceReference: false,
			},
			{
				id: "project:ref:src/index.ts:2:1:ghost-lib",
				packageName: "project",
				dependencyName: "ghost-lib",
				filePath: "src/index.ts",
				line: 2,
				column: 1,
				kind: "import",
				specifier: "ghost-lib",
				isWorkspaceReference: false,
			},
		],
		issues: [
			{
				id: "project:issue:unused:unused-lib",
				packageName: "project",
				dependencyName: "unused-lib",
				issueType: "unused-dependency",
				reason: "unused",
				supportingEvidenceIds: ["project:decl:dependencies:unused-lib"],
			},
			{
				id: "project:issue:unused:tooling-lib",
				packageName: "project",
				dependencyName: "tooling-lib",
				issueType: "unused-dependency",
				reason: "unused",
				supportingEvidenceIds: ["project:decl:dependencies:tooling-lib"],
			},
			{
				id: "project:issue:ghost:ghost-lib",
				packageName: "project",
				dependencyName: "ghost-lib",
				issueType: "ghost-dependency",
				reason: "ghost",
				supportingEvidenceIds: ["project:ref:src/index.ts:2:1:ghost-lib"],
			},
		],
		signals: [
			{
				id: "project:signal:tooling-string:src/config.ts:1:1:tooling-lib",
				packageName: "project",
				dependencyName: "tooling-lib",
				filePath: "src/config.ts",
				line: 1,
				column: 1,
				signalType: "tooling-string",
				fileRole: "config",
				value: "tooling-lib",
			},
		],
	},
};

describe("report builders and query helpers", () => {
	it("hides dynamic dependencies from displayable unused dependencies", () => {
		expect(getDisplayableUnusedDependencies(report.summary)).toEqual([
			"unused-lib",
			"tooling-lib",
		]);
	});

	it("returns package-level summary lists", () => {
		expect(getPackageSummary(report)).toMatchObject({
			packageName: "project",
			unusedDependencies: ["unused-lib", "tooling-lib"],
			ghostDependencies: ["ghost-lib"],
			issueCount: 3,
		});
		expect(getUnusedDependencies(report)).toEqual(["unused-lib", "tooling-lib"]);
		expect(getGhostDependencies(report)).toEqual(["ghost-lib"]);
	});

	it("classifies review candidates from evidence", () => {
		expect(getDependencyReviewCandidate(report, "used-lib")).toMatchObject({
			disposition: "confirmed-used",
			confidence: "high",
		});
		expect(getDependencyReviewCandidate(report, "unused-lib")).toMatchObject({
			disposition: "high-confidence-unused",
			confidence: "high",
		});
		expect(getDependencyReviewCandidate(report, "tooling-lib")).toMatchObject({
			disposition: "likely-tooling-usage",
			confidence: "medium",
		});
	});
});
