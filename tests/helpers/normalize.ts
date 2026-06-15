import {
	AnalysisReport,
	IssueEvidence,
	MonorepoPackageAnalysisReport,
	ReferenceEvidence,
	SignalEvidence,
	SingleProjectAnalysisReport,
} from "../../src/types";

type NormalizedDependencyMap<T> = Record<string, T[]>;

interface NormalizedPackage {
	name: string;
	unusedDependencies: string[];
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
		bucket.push(issue.issueType);
		groups[issue.dependencyName] = sorted(bucket);
		return groups;
	}, {});
}

function normalizeSingleProject(report: SingleProjectAnalysisReport): NormalizedPackage {
	const packageName = report.evidence.declarations[0]?.packageName || "project";
	return {
		name: packageName,
		unusedDependencies: sorted(
			report.summary.unusedDependencies
				.filter((dependency) => dependency.type !== "dynamic" && !dependency.isDev)
				.map((dependency) => dependency.name)
				.filter((name) => name && name !== "undefined")
		),
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
		unusedDependencies: sorted(pkg.unusedDependencies),
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
