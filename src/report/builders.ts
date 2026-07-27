import {
	Dependency,
	MonorepoAnalysisReport,
	MonorepoEvidenceIndex,
	MonorepoPackageAnalysisReport,
	PackageEvidenceChain,
	Result,
	SingleProjectAnalysisReport,
} from "../types";
import { isRemovalRecommended } from "../analyzer/dependency";

interface MonorepoPackageReportInput {
	name: string;
	path: string;
	summary: Result;
	usedImports: string[];
	declaredDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	evidence: PackageEvidenceChain;
}

export function createEmptyPackageEvidenceChain(): PackageEvidenceChain {
	return {
		declarations: [],
		references: [],
		issues: [],
		signals: [],
	};
}

export function createEmptyMonorepoEvidenceIndex(
	packageNames: string[] = []
): MonorepoEvidenceIndex {
	return {
		packages: [...packageNames].sort((a, b) => a.localeCompare(b)),
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
	};
}

/**
 * 建议直接移除声明的未使用依赖（orphan + still-installed）。
 * peer 要求与版本钉住这两类需要人工确认，不放进这个列表。
 */
export function getRemovableUnusedDependencies(summary: Result | null): string[] {
	if (!summary) return [];
	return summary.unusedDependencies
		.filter((dependency) => isRemovalRecommended(dependency.unusedClass || "unused-orphan"))
		.map((dependency) => dependency.name)
		.filter((name) => name !== "" && name !== "undefined");
}

export function getUnusedDependenciesByClass(
	summary: Result | null,
	unusedClass: Dependency["unusedClass"]
): Dependency[] {
	if (!summary) return [];
	return summary.unusedDependencies.filter(
		(dependency) => (dependency.unusedClass || "unused-orphan") === unusedClass
	);
}

/** 全部未被引用的运行时依赖名（含需要人工确认的分类）。 */
export function getAllUnusedDependencyNames(summary: Result | null): string[] {
	if (!summary) return [];
	return summary.unusedDependencies
		.map((dependency) => dependency.name)
		.filter((name) => name !== "" && name !== "undefined");
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
		unusedDependencies: getAllUnusedDependencyNames(input.summary),
		removableDependencies: getRemovableUnusedDependencies(input.summary),
		workspaceDependencies: input.workspaceDependencies,
		undeclaredWorkspaceDependencies: input.undeclaredWorkspaceDependencies,
		ghostDependencies: input.ghostDependencies,
		dynamicImports: input.summary.dynamicImports,
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
