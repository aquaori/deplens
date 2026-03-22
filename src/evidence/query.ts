import {
	DeclarationEvidence,
	IssueEvidence,
	MonorepoAnalysisReport,
	MonorepoEvidenceIndex,
	PackageEvidenceChain,
	ReferenceEvidence,
	SignalEvidence,
	SingleProjectAnalysisReport,
} from "../types";

interface EvidenceQueryOptions {
	dependencyName?: string;
	packageName?: string;
	issueType?: IssueEvidence["issueType"];
}

function groupByDependency<T extends { dependencyName: string }>(items: T[]): Record<string, T[]> {
	const grouped: Record<string, T[]> = {};
	for (const item of items) {
		const dependencyKey = item.dependencyName;
		const bucket = grouped[dependencyKey] || [];
		bucket.push(item);
		grouped[dependencyKey] = bucket;
	}
	return grouped;
}

function groupByPackage<T extends { packageName: string }>(items: T[]): Record<string, T[]> {
	const grouped: Record<string, T[]> = {};
	for (const item of items) {
		const packageKey = item.packageName;
		const bucket = grouped[packageKey] || [];
		bucket.push(item);
		grouped[packageKey] = bucket;
	}
	return grouped;
}

function sortReferences(references: ReferenceEvidence[]): ReferenceEvidence[] {
	return [...references].sort((a, b) => {
		if (a.packageName !== b.packageName) return a.packageName.localeCompare(b.packageName);
		if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
		if (a.line !== b.line) return a.line - b.line;
		return a.column - b.column;
	});
}

function sortDeclarations(declarations: DeclarationEvidence[]): DeclarationEvidence[] {
	return [...declarations].sort((a, b) => {
		if (a.packageName !== b.packageName) return a.packageName.localeCompare(b.packageName);
		if (a.section !== b.section) return a.section.localeCompare(b.section);
		return a.dependencyName.localeCompare(b.dependencyName);
	});
}

function sortIssues(issues: IssueEvidence[]): IssueEvidence[] {
	return [...issues].sort((a, b) => {
		if (a.packageName !== b.packageName) return a.packageName.localeCompare(b.packageName);
		if (a.issueType !== b.issueType) return a.issueType.localeCompare(b.issueType);
		return a.dependencyName.localeCompare(b.dependencyName);
	});
}

function sortSignals(signals: SignalEvidence[]): SignalEvidence[] {
	return [...signals].sort((a, b) => {
		if (a.packageName !== b.packageName) return a.packageName.localeCompare(b.packageName);
		if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
		if (a.line !== b.line) return a.line - b.line;
		return a.column - b.column;
	});
}

function matchDependency<T extends { dependencyName: string }>(
	items: T[],
	dependencyName?: string
): T[] {
	if (!dependencyName) return items;
	return items.filter((item) => item.dependencyName === dependencyName);
}

function matchPackage<T extends { packageName: string }>(items: T[], packageName?: string): T[] {
	if (!packageName) return items;
	return items.filter((item) => item.packageName === packageName);
}

function getDeclarationsFromIndex(
	evidenceIndex: MonorepoEvidenceIndex,
	query: EvidenceQueryOptions
): DeclarationEvidence[] {
	if (query.dependencyName && query.packageName) {
		return matchPackage(
			evidenceIndex.declarationsByDependency[query.dependencyName] || [],
			query.packageName
		);
	}
	if (query.dependencyName) {
		return evidenceIndex.declarationsByDependency[query.dependencyName] || [];
	}
	if (query.packageName) {
		return evidenceIndex.declarationsByPackage[query.packageName] || [];
	}
	return evidenceIndex.declarations;
}

function getReferencesFromIndex(
	evidenceIndex: MonorepoEvidenceIndex,
	query: EvidenceQueryOptions
): ReferenceEvidence[] {
	if (query.dependencyName && query.packageName) {
		return matchPackage(
			evidenceIndex.referencesByDependency[query.dependencyName] || [],
			query.packageName
		);
	}
	if (query.dependencyName) {
		return evidenceIndex.referencesByDependency[query.dependencyName] || [];
	}
	if (query.packageName) {
		return evidenceIndex.referencesByPackage[query.packageName] || [];
	}
	return evidenceIndex.references;
}

function getIssuesFromIndex(
	evidenceIndex: MonorepoEvidenceIndex,
	query: EvidenceQueryOptions
): IssueEvidence[] {
	if (query.dependencyName && query.packageName) {
		return matchPackage(
			evidenceIndex.issuesByDependency[query.dependencyName] || [],
			query.packageName
		);
	}
	if (query.dependencyName) {
		return evidenceIndex.issuesByDependency[query.dependencyName] || [];
	}
	if (query.packageName) {
		return evidenceIndex.issuesByPackage[query.packageName] || [];
	}
	return evidenceIndex.issues;
}

function getSignalsFromIndex(
	evidenceIndex: MonorepoEvidenceIndex,
	query: EvidenceQueryOptions
): SignalEvidence[] {
	if (query.dependencyName && query.packageName) {
		return matchPackage(
			evidenceIndex.signalsByDependency[query.dependencyName] || [],
			query.packageName
		);
	}
	if (query.dependencyName) {
		return evidenceIndex.signalsByDependency[query.dependencyName] || [];
	}
	if (query.packageName) {
		return evidenceIndex.signalsByPackage[query.packageName] || [];
	}
	return evidenceIndex.signals;
}

function getEvidenceIndex(
	input: PackageEvidenceChain | MonorepoEvidenceIndex | SingleProjectAnalysisReport | MonorepoAnalysisReport
): MonorepoEvidenceIndex {
	if ("kind" in input) {
		if (input.kind === "monorepo") {
			return input.evidenceIndex;
		}
		const declarations = input.evidence.declarations;
		const references = input.evidence.references;
		const issues = input.evidence.issues;
		const signals = input.evidence.signals;
		return {
			packages: [declarations[0]?.packageName || input.path],
			declarations,
			references,
			issues,
			signals,
			declarationsByDependency: groupByDependency(declarations),
			referencesByDependency: groupByDependency(references),
			issuesByDependency: groupByDependency(issues),
			signalsByDependency: groupByDependency(signals),
			declarationsByPackage: groupByPackage(declarations),
			referencesByPackage: groupByPackage(references),
			issuesByPackage: groupByPackage(issues),
			signalsByPackage: groupByPackage(signals),
		};
	}

	if ("declarationsByDependency" in input) {
		return input;
	}

	const declarations = input.declarations;
	const references = input.references;
	const issues = input.issues;
	const signals = input.signals;

	return {
		packages: Array.from(new Set(declarations.map((item) => item.packageName))),
		declarations,
		references,
		issues,
		signals,
		declarationsByDependency: groupByDependency(declarations),
		referencesByDependency: groupByDependency(references),
		issuesByDependency: groupByDependency(issues),
		signalsByDependency: groupByDependency(signals),
		declarationsByPackage: groupByPackage(declarations),
		referencesByPackage: groupByPackage(references),
		issuesByPackage: groupByPackage(issues),
		signalsByPackage: groupByPackage(signals),
	};
}

export function findDependencyReferences(
	input: PackageEvidenceChain | MonorepoEvidenceIndex | SingleProjectAnalysisReport | MonorepoAnalysisReport,
	options: string | EvidenceQueryOptions
): ReferenceEvidence[] {
	const query = typeof options === "string" ? { dependencyName: options } : options;
	const evidenceIndex = getEvidenceIndex(input);
	const references = getReferencesFromIndex(evidenceIndex, query);
	return sortReferences(references);
}

export function findDependencyDeclarations(
	input: PackageEvidenceChain | MonorepoEvidenceIndex | SingleProjectAnalysisReport | MonorepoAnalysisReport,
	options: string | EvidenceQueryOptions
): DeclarationEvidence[] {
	const query = typeof options === "string" ? { dependencyName: options } : options;
	const evidenceIndex = getEvidenceIndex(input);
	const declarations = getDeclarationsFromIndex(evidenceIndex, query);
	return sortDeclarations(declarations);
}

export function findIssueEvidence(
	input: PackageEvidenceChain | MonorepoEvidenceIndex | SingleProjectAnalysisReport | MonorepoAnalysisReport,
	options: EvidenceQueryOptions = {}
): IssueEvidence[] {
	const evidenceIndex = getEvidenceIndex(input);
	let issues = getIssuesFromIndex(evidenceIndex, options);

	if (options.issueType) {
		issues = issues.filter((issue) => issue.issueType === options.issueType);
	}

	return sortIssues(issues);
}

export function findDependencySignals(
	input: PackageEvidenceChain | MonorepoEvidenceIndex | SingleProjectAnalysisReport | MonorepoAnalysisReport,
	options: string | EvidenceQueryOptions
): SignalEvidence[] {
	const query = typeof options === "string" ? { dependencyName: options } : options;
	const evidenceIndex = getEvidenceIndex(input);
	const signals = getSignalsFromIndex(evidenceIndex, query);
	return sortSignals(signals);
}

export function explainDependencyEvidence(
	input: PackageEvidenceChain | MonorepoEvidenceIndex | SingleProjectAnalysisReport | MonorepoAnalysisReport,
	options: string | EvidenceQueryOptions
) {
	const query = typeof options === "string" ? { dependencyName: options } : options;
	return {
		declarations: findDependencyDeclarations(input, query),
		references: findDependencyReferences(input, query),
		issues: findIssueEvidence(input, query),
		signals: findDependencySignals(input, query),
	};
}
