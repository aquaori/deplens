import {
	AnalysisReport,
	IssueEvidence,
	MonorepoPackageAnalysisReport,
	ReferenceEvidence,
	Result,
	SignalEvidence,
	SingleProjectAnalysisReport,
	UnusedDependencyClass,
} from "../../src/types";
import {
	getAllUnusedDependencyNames,
	getRemovableUnusedDependencies,
} from "../../src/report/builders";

type NormalizedDependencyMap<T> = Record<string, T[]>;

interface NormalizedPackage {
	name: string;
	unusedDependencies: string[];
	removableDependencies: string[];
	unusedByClass: Record<string, string[]>;
	unusedDevDependencies: string[];
	typeOnlyDependencies: string[];
	ghostDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	referencesByDependency: NormalizedDependencyMap<string>;
	signalsByDependency: NormalizedDependencyMap<string>;
	issuesByDependency: NormalizedDependencyMap<string>;
}

export interface NormalizedReport {
	kind: AnalysisReport["kind"];
	packageCount: number;
	packages: NormalizedPackage[];
}

function sorted(items: string[]): string[] {
	return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

function groupUnusedByClass(summary: Result): Record<string, string[]> {
	const grouped: Record<string, string[]> = {};
	for (const dependency of summary.unusedDependencies) {
		const key: UnusedDependencyClass = dependency.unusedClass || "unused-orphan";
		const bucket = grouped[key] || [];
		bucket.push(dependency.name);
		grouped[key] = sorted(bucket);
	}
	return grouped;
}

function groupReferences(references: ReferenceEvidence[]): NormalizedDependencyMap<string> {
	return references.reduce<NormalizedDependencyMap<string>>((groups, reference) => {
		const bucket = groups[reference.dependencyName] || [];
		bucket.push(`${reference.kind}:${reference.specifier}:${reference.filePath}`);
		groups[reference.dependencyName] = sorted(bucket);
		return groups;
	}, {});
}

function groupSignals(signals: SignalEvidence[]): NormalizedDependencyMap<string> {
	return signals.reduce<NormalizedDependencyMap<string>>((groups, signal) => {
		const bucket = groups[signal.dependencyName] || [];
		bucket.push(`${signal.signalType}:${signal.fileRole}`);
		groups[signal.dependencyName] = sorted(bucket);
		return groups;
	}, {});
}

function groupIssues(issues: IssueEvidence[]): NormalizedDependencyMap<string> {
	return issues.reduce<NormalizedDependencyMap<string>>((groups, issue) => {
		const bucket = groups[issue.dependencyName] || [];
		bucket.push(issue.dependencyClass ? `${issue.issueType}:${issue.dependencyClass}` : issue.issueType);
		groups[issue.dependencyName] = sorted(bucket);
		return groups;
	}, {});
}

function normalizeSummaryFields(summary: Result) {
	return {
		unusedDependencies: getAllUnusedDependencyNames(summary),
		removableDependencies: getRemovableUnusedDependencies(summary),
		unusedByClass: groupUnusedByClass(summary),
		unusedDevDependencies: sorted(summary.devDependencies.map((item) => item.name)),
		typeOnlyDependencies: sorted(summary.typeOnlyDependencies.map((item) => item.name)),
	};
}

function normalizeSingleProject(report: SingleProjectAnalysisReport): NormalizedPackage {
	return {
		name: report.evidence.declarations[0]?.packageName || "project",
		...normalizeSummaryFields(report.summary),
		ghostDependencies: sorted(
			report.evidence.issues
				.filter((issue) => issue.issueType === "ghost-dependency")
				.map((issue) => issue.dependencyName)
		),
		undeclaredWorkspaceDependencies: sorted(
			report.evidence.issues
				.filter((issue) => issue.issueType === "undeclared-workspace-dependency")
				.map((issue) => issue.dependencyName)
		),
		referencesByDependency: groupReferences(report.evidence.references),
		signalsByDependency: groupSignals(report.evidence.signals),
		issuesByDependency: groupIssues(report.evidence.issues),
	};
}

function normalizeMonorepoPackage(pkg: MonorepoPackageAnalysisReport): NormalizedPackage {
	return {
		name: pkg.name,
		...normalizeSummaryFields(pkg.summary),
		ghostDependencies: sorted(pkg.ghostDependencies),
		undeclaredWorkspaceDependencies: sorted(pkg.undeclaredWorkspaceDependencies),
		referencesByDependency: groupReferences(pkg.evidence.references),
		signalsByDependency: groupSignals(pkg.evidence.signals),
		issuesByDependency: groupIssues(pkg.evidence.issues),
	};
}

export function normalizeReport(report: AnalysisReport): NormalizedReport {
	if (report.kind === "project") {
		return {
			kind: "project",
			packageCount: 1,
			packages: [normalizeSingleProject(report)],
		};
	}

	return {
		kind: "monorepo",
		packageCount: report.packageCount,
		packages: report.packages
			.map(normalizeMonorepoPackage)
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}
