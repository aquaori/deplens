import {
	MonorepoAnalysisReport,
	MonorepoEvidenceIndex,
	MonorepoPackageAnalysisReport,
	PackageEvidenceChain,
	Result,
	SingleProjectAnalysisReport,
} from "../types";

interface MonorepoPackageReportInput {
	name: string;
	path: string;
	summary: Result | null;
	usedImports: string[];
	declaredDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	evidence: PackageEvidenceChain;
}

export function getDisplayableUnusedDependencies(summary: Result | null): string[] {
	if (!summary) return [];
	return summary.unusedDependencies
		.filter((dependency) => dependency.type !== "dynamic")
		.map((dependency) => dependency.name)
		.filter((dependencyName): dependencyName is string => {
			return dependencyName !== "" && dependencyName !== "undefined";
		});
}

export function getDynamicUnusedDependencies(summary: Result | null): string[] {
	if (!summary) return [];
	return summary.unusedDependencies
		.filter((dependency) => dependency.type === "dynamic")
		.map((dependency) => dependency.args || dependency.name || "")
		.filter((dependencyName) => dependencyName !== "");
}

export function buildProjectAnalysisReport(
	projectPath: string,
	summary: Result,
	evidence: PackageEvidenceChain
): SingleProjectAnalysisReport {
	return {
		kind: "project",
		path: projectPath,
		summary,
		evidence,
	};
}

export function buildMonorepoPackageAnalysisReport(
	input: MonorepoPackageReportInput
): MonorepoPackageAnalysisReport {
	return {
		name: input.name,
		path: input.path,
		summary: input.summary,
		usedImports: input.usedImports,
		declaredDependencies: input.declaredDependencies,
		unusedDependencies: getDisplayableUnusedDependencies(input.summary),
		workspaceDependencies: input.workspaceDependencies,
		undeclaredWorkspaceDependencies: input.undeclaredWorkspaceDependencies,
		ghostDependencies: input.ghostDependencies,
		dynamicUnusedDependencies: getDynamicUnusedDependencies(input.summary),
		evidence: input.evidence,
	};
}

export function buildMonorepoAnalysisReport(
	projectPath: string,
	monorepoType: "npm" | "pnpm" | "unknown",
	packages: MonorepoPackageAnalysisReport[],
	evidenceIndex: MonorepoEvidenceIndex
): MonorepoAnalysisReport {
	return {
		kind: "monorepo",
		projectPath,
		monorepoType,
		packageCount: packages.length,
		packagesWithUnusedDependencies: packages.filter(
			(pkg) => pkg.unusedDependencies.length > 0
		).length,
		packagesWithGhostDependencies: packages.filter(
			(pkg) => pkg.ghostDependencies.length > 0
		).length,
		packagesWithoutUnusedDependencies: packages.filter(
			(pkg) => pkg.unusedDependencies.length === 0
		).length,
		packages,
		evidenceIndex,
	};
}
