import {
	getAllUnusedDependencyNames,
	getRemovableUnusedDependencies,
} from "../../src/report/builders";
import {
	canRemoveDependency,
	getDependencyReviewCandidate,
	getGhostDependencies,
	getPackageSummary,
	getUnusedDependencies,
} from "../../src/query";
import { Dependency, SingleProjectAnalysisReport } from "../../src/types";

function unused(name: string, unusedClass: NonNullable<Dependency["unusedClass"]>): Dependency {
	return {
		name,
		type: "",
		version: ["1.0.0"],
		usage: false,
		isDev: false,
		section: "dependencies",
		requiredBy: unusedClass === "unused-orphan"
			? []
			: [{ package: "some-tool", section: unusedClass === "keep-peer-requirement" ? "peerDependencies" : "dependencies", range: "1.0.0" }],
		unusedClass,
	};
}

const report: SingleProjectAnalysisReport = {
	kind: "project",
	path: "/workspace/project",
	summary: {
		usedDependencies: 1,
		unusedDependencies: [
			unused("unused-lib", "unused-orphan"),
			unused("tooling-lib", "unused-orphan"),
			unused("still-installed-lib", "unused-still-installed"),
			unused("peer-lib", "keep-peer-requirement"),
		],
		unusedDependenciesCount: 4,
		ununsedDependenciesCount: 4,
		totalDependencies: 6,
		transitiveEdgeCount: 120,
		devDependencies: [],
		typeOnlyDependencies: [],
		dynamicImports: [
			{ filePath: "src/index.ts", line: 3, kind: "require", expression: "require(name)" },
		],
		lockfile: { resolved: true, manager: "npm", path: "/workspace/project/package-lock.json" },
	},
	evidence: {
		declarations: ["used-lib", "unused-lib", "tooling-lib", "still-installed-lib", "peer-lib"].map(
			(dependencyName) => ({
				id: `project:decl:dependencies:${dependencyName}`,
				packageName: "project",
				dependencyName,
				manifestPath: "package.json",
				section: "dependencies" as const,
				versionRange: "1.0.0",
			})
		),
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
				isTypeOnly: false,
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
				isTypeOnly: false,
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
				dependencyClass: "unused-orphan",
			},
			{
				id: "project:issue:unused:tooling-lib",
				packageName: "project",
				dependencyName: "tooling-lib",
				issueType: "unused-dependency",
				reason: "unused",
				supportingEvidenceIds: ["project:decl:dependencies:tooling-lib"],
				dependencyClass: "unused-orphan",
			},
			{
				id: "project:issue:unused:still-installed-lib",
				packageName: "project",
				dependencyName: "still-installed-lib",
				issueType: "unused-dependency",
				reason: "unused",
				supportingEvidenceIds: ["project:decl:dependencies:still-installed-lib"],
				dependencyClass: "unused-still-installed",
			},
			{
				id: "project:issue:unused:peer-lib",
				packageName: "project",
				dependencyName: "peer-lib",
				issueType: "unused-dependency",
				reason: "peer",
				supportingEvidenceIds: ["project:decl:dependencies:peer-lib"],
				dependencyClass: "keep-peer-requirement",
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
	it("separates removable declarations from ones that must be reviewed", () => {
		expect(getAllUnusedDependencyNames(report.summary)).toEqual([
			"unused-lib",
			"tooling-lib",
			"still-installed-lib",
			"peer-lib",
		]);
		expect(getRemovableUnusedDependencies(report.summary)).toEqual([
			"unused-lib",
			"tooling-lib",
			"still-installed-lib",
		]);
	});

	it("returns package-level summary lists", () => {
		expect(getPackageSummary(report)).toMatchObject({
			packageName: "project",
			unusedDependencies: ["unused-lib", "tooling-lib", "still-installed-lib", "peer-lib"],
			ghostDependencies: ["ghost-lib"],
			issueCount: 5,
		});
		expect(getUnusedDependencies(report)).toEqual([
			"unused-lib",
			"tooling-lib",
			"still-installed-lib",
			"peer-lib",
		]);
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

	it("never proposes removing a peer-required declaration", () => {
		expect(getDependencyReviewCandidate(report, "peer-lib")).toMatchObject({
			disposition: "needs-review",
		});
		expect(canRemoveDependency(report, "peer-lib")).toMatchObject({
			recommended: false,
			riskLevel: "high",
		});
	});

	it("treats a transitively required declaration as a safe removal", () => {
		expect(canRemoveDependency(report, "still-installed-lib")).toMatchObject({
			recommended: true,
			riskLevel: "low",
			confidence: "high",
		});
	});
});
