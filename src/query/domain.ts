import fs from "fs";
import path from "path";
import {
	AnalysisReport,
	CodeContextSnippet,
	DependencyContextBundle,
	DependencyReviewDisposition,
	DependencyReviewCandidate,
	DependencyOverview,
	MonorepoAnalysisReport,
	MonorepoPackageAnalysisReport,
	PackageIssueRankingView,
	PackageSummaryView,
	ProjectSummaryView,
	RemovalAssessment,
	SignalEvidence,
	SingleProjectAnalysisReport,
	UnusedDependencyClass,
} from "../types";
import {
	explainDependencyEvidence,
	findIssueEvidence,
} from "../evidence";
import { getAllUnusedDependencyNames } from "../report/builders";
import { isRemovalRecommended } from "../analyzer/dependency";

function getDefaultSinglePackageName(report: SingleProjectAnalysisReport): string {
	return report.evidence.declarations[0]?.packageName || path.basename(path.resolve(report.path));
}

function getSingleProjectPackageSummary(report: SingleProjectAnalysisReport): PackageSummaryView {
	const packageName = getDefaultSinglePackageName(report);
	const declaredDependencies = report.evidence.declarations
		.filter((item) => item.section !== "devDependencies")
		.map((item) => item.dependencyName);
	const uniqueReferences = new Set(report.evidence.references.map((item) => item.dependencyName));

	return {
		packageName,
		path: report.path,
		declaredDependencies: new Set(declaredDependencies).size,
		referencedDependencies: uniqueReferences.size,
		unusedDependencies: getAllUnusedDependencyNames(report.summary),
		ghostDependencies: findIssueEvidence(report, {
			packageName,
			issueType: "ghost-dependency",
		}).map((item) => item.dependencyName),
		workspaceDependencies: [],
		undeclaredWorkspaceDependencies: [],
		issueCount: report.evidence.issues.length,
	};
}

function getMonorepoPackageReport(
	report: MonorepoAnalysisReport,
	packageName: string
): MonorepoPackageAnalysisReport {
	const packageReport = report.packages.find(
		(item) => item.name === packageName || item.path === packageName
	);

	if (!packageReport) {
		throw new Error(`Package ${packageName} was not found in the current monorepo report.`);
	}

	return packageReport;
}

function uniqueSorted(items: string[]): string[] {
	return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

function uniqueSignalTypes(signals: SignalEvidence[]): SignalEvidence["signalType"][] {
	return Array.from(new Set(signals.map((item) => item.signalType))).sort();
}

function uniqueSignalRoles(signals: SignalEvidence[]): SignalEvidence["fileRole"][] {
	return Array.from(new Set(signals.map((item) => item.fileRole))).sort();
}

function withOptionalPackageName<T extends Record<string, unknown>>(
	base: T,
	packageName?: string
): T & { packageName?: string } {
	if (!packageName) return base;
	return {
		...base,
		packageName,
	};
}

function buildRemovalAssessment(
	base: Omit<RemovalAssessment, "packageName">,
	packageName?: string
): RemovalAssessment {
	if (!packageName) {
		return base;
	}

	return {
		...base,
		packageName,
	};
}

function buildReviewCandidate(
	base: Omit<DependencyReviewCandidate, "packageName">,
	packageName?: string
): DependencyReviewCandidate {
	if (!packageName) {
		return base;
	}

	return {
		...base,
		packageName,
	};
}

function buildContextBundle(
	base: Omit<DependencyContextBundle, "packageName">,
	packageName?: string
): DependencyContextBundle {
	if (!packageName) {
		return base;
	}

	return {
		...base,
		packageName,
	};
}

function safeReadFile(filePath: string): string | null {
	try {
		if (!fs.existsSync(filePath)) {
			return null;
		}
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

function buildSnippet(
	filePath: string,
	absolutePath: string,
	focusLine: number,
	radius: number,
	origin: CodeContextSnippet["origin"],
	fileRole: CodeContextSnippet["fileRole"],
	summary: string
): CodeContextSnippet | null {
	// 必须用绝对路径读取：filePath 是相对被分析项目（monorepo 下相对子包）的展示路径，
	// 按 process.cwd() 解析会在 `-p other/path` 和 monorepo 下永远读不到文件。
	const code = safeReadFile(absolutePath);
	if (!code) {
		return null;
	}

	const lines = code.replace(/\r\n/g, "\n").split("\n");
	if (lines.length === 0) {
		return null;
	}

	const resolvedFocus = Math.min(Math.max(focusLine, 1), lines.length);
	const lineStart = Math.max(1, resolvedFocus - radius);
	const lineEnd = Math.min(lines.length, resolvedFocus + radius);
	const snippetLines: string[] = [];

	for (let line = lineStart; line <= lineEnd; line += 1) {
		const prefix = line === resolvedFocus ? ">" : " ";
		const lineText = lines[line - 1] ?? "";
		snippetLines.push(`${prefix} ${String(line).padStart(4, " ")} | ${lineText}`);
	}

	return {
		filePath,
		lineStart,
		lineEnd,
		focusLine: resolvedFocus,
		origin,
		fileRole,
		summary,
		code: snippetLines.join("\n"),
	};
}

/**
 * 建立「包名 -> 该包在磁盘上的绝对根目录」的映射。
 *
 * 证据里的 filePath 是相对包根的展示路径；旧实现直接把它交给 fs 读取，
 * 于是按 process.cwd() 解析：只要分析目标不是当前目录（`-p other/path`），
 * 或者处于 monorepo（路径相对子包），代码片段就永远读不出来。
 */
function buildPackageRootIndex(report: AnalysisReport): Map<string, string> {
	const roots = new Map<string, string>();

	if (report.kind === "project") {
		const projectRoot = path.resolve(report.path);
		roots.set(getDefaultSinglePackageName(report), projectRoot);
		for (const declaration of report.evidence.declarations) {
			roots.set(declaration.packageName, projectRoot);
		}
		return roots;
	}

	for (const pkg of report.packages) {
		roots.set(pkg.name, path.resolve(report.projectPath, pkg.path));
	}
	return roots;
}

function resolveEvidencePath(
	roots: Map<string, string>,
	fallbackRoot: string,
	packageName: string,
	filePath: string
): string {
	return path.resolve(roots.get(packageName) || fallbackRoot, filePath);
}

function getUnusedClass(overview: DependencyOverview): UnusedDependencyClass | undefined {
	return overview.issues.find((item) => item.issueType === "unused-dependency")?.dependencyClass;
}

const REMOVAL_REASON: Record<UnusedDependencyClass, string> = {
	"unused-orphan":
		"No static source reference was found and no installed package depends on it, so the declaration can be removed. The package will also disappear from the dependency tree.",
	"unused-still-installed":
		"No static source reference was found. Other installed packages still depend on it, so removing this declaration does not uninstall the package and is low risk.",
	"unused-version-pin":
		"No static source reference was found, but the declared range is not accepted by every package that requires it. Removing the declaration would change version resolution, so confirm the pin is not intentional.",
	"keep-peer-requirement":
		"An installed package requires it as a peer dependency, so this project is expected to declare it. Removing the declaration would break installation.",
	"risk-unknown":
		"The lockfile could not be resolved, so removal risk is unknown. Verify the dependency tree before removing this declaration.",
};

function uniqueSortedSignals(signals: SignalEvidence[]): SignalEvidence[] {
	return [...signals].sort((a, b) => {
		if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
		if (a.line !== b.line) return a.line - b.line;
		return a.column - b.column;
	});
}

export function getProjectSummary(report: AnalysisReport): ProjectSummaryView {
	if (report.kind === "project") {
		return {
			kind: "project",
			projectPath: report.path,
			packageCount: 1,
			packagesWithUnusedDependencies: report.summary.unusedDependenciesCount > 0 ? 1 : 0,
			packagesWithGhostDependencies: findIssueEvidence(report, {
				issueType: "ghost-dependency",
			}).length > 0
				? 1
				: 0,
			totalDeclarations: report.evidence.declarations.length,
			totalReferences: report.evidence.references.length,
			totalIssues: report.evidence.issues.length,
		};
	}

	return {
		kind: "monorepo",
		projectPath: report.projectPath,
		packageCount: report.packageCount,
		packagesWithUnusedDependencies: report.packagesWithUnusedDependencies,
		packagesWithGhostDependencies: report.packagesWithGhostDependencies,
		totalDeclarations: report.evidenceIndex.declarations.length,
		totalReferences: report.evidenceIndex.references.length,
		totalIssues: report.evidenceIndex.issues.length,
		monorepoType: report.monorepoType,
	};
}

export function getPackageSummary(
	report: AnalysisReport,
	packageName?: string
): PackageSummaryView {
	if (report.kind === "project") {
		return getSingleProjectPackageSummary(report);
	}

	if (!packageName) {
		throw new Error("packageName is required when calling getPackageSummary() for a monorepo report.");
	}

	const packageReport = getMonorepoPackageReport(report, packageName);
	return {
		packageName: packageReport.name,
		path: packageReport.path,
		declaredDependencies: packageReport.declaredDependencies.length,
		referencedDependencies: packageReport.usedImports.length,
		unusedDependencies: packageReport.unusedDependencies,
		ghostDependencies: packageReport.ghostDependencies,
		workspaceDependencies: packageReport.workspaceDependencies,
		undeclaredWorkspaceDependencies: packageReport.undeclaredWorkspaceDependencies,
		issueCount: packageReport.evidence.issues.length,
	};
}

export function getUnusedDependencies(
	report: AnalysisReport,
	packageName?: string
): string[] {
	if (report.kind === "project") {
		return getSingleProjectPackageSummary(report).unusedDependencies;
	}

	if (packageName) {
		return getMonorepoPackageReport(report, packageName).unusedDependencies;
	}

	return uniqueSorted(report.packages.flatMap((pkg) => pkg.unusedDependencies));
}

export function getGhostDependencies(
	report: AnalysisReport,
	packageName?: string
): string[] {
	if (report.kind === "project") {
		return uniqueSorted(
			findIssueEvidence(report, { issueType: "ghost-dependency" }).map(
				(item) => item.dependencyName
			)
		);
	}

	if (packageName) {
		return getMonorepoPackageReport(report, packageName).ghostDependencies;
	}

	return uniqueSorted(report.packages.flatMap((pkg) => pkg.ghostDependencies));
}

export function getDependencyOverview(
	report: AnalysisReport,
	dependencyName: string,
	packageName?: string
): DependencyOverview {
	const explanation = explainDependencyEvidence(
		report,
		withOptionalPackageName({ dependencyName }, packageName)
	);
	const issues = explanation.issues;
	const references = explanation.references;

	return withOptionalPackageName({
		dependencyName,
		declarations: explanation.declarations,
		references,
		issues,
		signals: explanation.signals,
		isDeclared: explanation.declarations.length > 0,
		isReferenced: references.length > 0,
		hasSignals: explanation.signals.length > 0,
		isGhostDependency: issues.some((item) => item.issueType === "ghost-dependency"),
		isUnusedDependency: issues.some((item) => item.issueType === "unused-dependency"),
		isUndeclaredWorkspaceDependency: issues.some(
			(item) => item.issueType === "undeclared-workspace-dependency"
		),
		referencedByPackages: uniqueSorted(references.map((item) => item.packageName)),
		referencedFiles: uniqueSorted(references.map((item) => item.filePath)),
	}, packageName);
}

export function getDependencyReviewCandidate(
	report: AnalysisReport,
	dependencyName: string,
	packageName?: string
): DependencyReviewCandidate {
	const overview = getDependencyOverview(report, dependencyName, packageName);
	const signalTypes = uniqueSignalTypes(overview.signals);
	const signalFileRoles = uniqueSignalRoles(overview.signals);
	const hasToolingSignals = signalFileRoles.includes("config")
		|| signalFileRoles.includes("tooling")
		|| signalFileRoles.includes("script")
		|| signalTypes.includes("tooling-string")
		|| signalTypes.includes("require-resolve");
	const unusedClass = getUnusedClass(overview);
	const createCandidate = (
		disposition: DependencyReviewDisposition,
		confidence: "low" | "medium" | "high",
		reason: string
	) => buildReviewCandidate({
		dependencyName,
		disposition,
		confidence,
		reason,
		isDeclared: overview.isDeclared,
		isReferenced: overview.isReferenced,
		isUnusedDependency: overview.isUnusedDependency,
		isGhostDependency: overview.isGhostDependency,
		signalCount: overview.signals.length,
		signalTypes,
		signalFileRoles,
		declarations: overview.declarations,
		references: overview.references,
		issues: overview.issues,
		signals: overview.signals,
	}, packageName);

	if (unusedClass === "risk-unknown") {
		return createCandidate("needs-review", "low", REMOVAL_REASON["risk-unknown"]);
	}

	if (overview.isGhostDependency) {
		return createCandidate(
			"ghost-dependency",
			overview.isReferenced ? "high" : "medium",
			overview.hasSignals
				? "The dependency is referenced without a declaration, and extra signals were also found. This may be a real ghost dependency or an implicit tooling/config usage."
				: "The dependency is referenced without a declaration in the current scope."
		);
	}

	if (overview.isReferenced) {
		return createCandidate(
			"confirmed-used",
			"high",
			"Static source references were found for this dependency."
		);
	}

	// peer 要求的依赖必须由本项目声明，无论有没有源码引用都不能算「高置信度未使用」。
	if (unusedClass === "keep-peer-requirement") {
		return createCandidate(
			"needs-review",
			"medium",
			REMOVAL_REASON["keep-peer-requirement"]
		);
	}

	if (overview.isUnusedDependency && !overview.hasSignals) {
		return createCandidate(
			"high-confidence-unused",
			unusedClass === "unused-version-pin" ? "medium" : "high",
			unusedClass ? REMOVAL_REASON[unusedClass] : "No static references or additional signals were found for this declared dependency."
		);
	}

	if (overview.hasSignals && hasToolingSignals) {
		return createCandidate(
			"likely-tooling-usage",
			"medium",
			"No standard imports were found, but config/script/tooling signals suggest this dependency may be used indirectly."
		);
	}

	return createCandidate(
		"needs-review",
		"low",
		"Static references were not found, but extra signals suggest this dependency may be used in a non-standard way."
	);
}

export function getDependencyReviewCandidates(
	report: AnalysisReport,
	packageName?: string
): DependencyReviewCandidate[] {
	const dependencyNames = new Set<string>();

	if (report.kind === "project") {
		report.evidence.declarations.forEach((item) => dependencyNames.add(item.dependencyName));
		report.evidence.issues.forEach((item) => dependencyNames.add(item.dependencyName));
		report.evidence.signals.forEach((item) => dependencyNames.add(item.dependencyName));
	} else if (packageName) {
		const packageReport = getMonorepoPackageReport(report, packageName);
		packageReport.evidence.declarations.forEach((item) => dependencyNames.add(item.dependencyName));
		packageReport.evidence.issues.forEach((item) => dependencyNames.add(item.dependencyName));
		packageReport.evidence.signals.forEach((item) => dependencyNames.add(item.dependencyName));
	} else {
		report.evidenceIndex.declarations.forEach((item) => dependencyNames.add(item.dependencyName));
		report.evidenceIndex.issues.forEach((item) => dependencyNames.add(item.dependencyName));
		report.evidenceIndex.signals.forEach((item) => dependencyNames.add(item.dependencyName));
	}

	return Array.from(dependencyNames)
		.sort((a, b) => a.localeCompare(b))
		.map((dependencyName) => getDependencyReviewCandidate(report, dependencyName, packageName))
		.sort((a, b) => {
			const rank = (candidate: DependencyReviewCandidate) => {
				switch (candidate.disposition) {
					case "ghost-dependency":
						return 0;
					case "needs-review":
						return 1;
					case "likely-tooling-usage":
						return 2;
					case "high-confidence-unused":
						return 3;
					case "confirmed-used":
					default:
						return 4;
				}
			};

			const rankDiff = rank(a) - rank(b);
			if (rankDiff !== 0) {
				return rankDiff;
			}
			if (b.signalCount !== a.signalCount) {
				return b.signalCount - a.signalCount;
			}
			return a.dependencyName.localeCompare(b.dependencyName);
		});
}

export function getDependencyContextBundle(
	report: AnalysisReport,
	dependencyName: string,
	packageName?: string,
	maxSnippets: number = 6
): DependencyContextBundle {
	const overview = getDependencyOverview(report, dependencyName, packageName);
	const seen = new Set<string>();
	const snippets: CodeContextSnippet[] = [];
	const packageRoots = buildPackageRootIndex(report);
	const fallbackRoot = report.kind === "project" ? report.path : report.projectPath;

	const pushSnippet = (snippet: CodeContextSnippet | null) => {
		if (!snippet) {
			return;
		}
		const key = `${snippet.filePath}:${snippet.focusLine}:${snippet.origin}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		snippets.push(snippet);
	};

	for (const reference of overview.references) {
		if (snippets.length >= maxSnippets) break;
		pushSnippet(buildSnippet(
			reference.filePath,
			resolveEvidencePath(packageRoots, fallbackRoot, reference.packageName, reference.filePath),
			reference.line,
			6,
			"reference",
			"reference",
			`${reference.kind} reference to ${reference.dependencyName}`
		));
	}

	for (const signal of uniqueSortedSignals(overview.signals)) {
		if (snippets.length >= maxSnippets) break;
		pushSnippet(buildSnippet(
			signal.filePath,
			resolveEvidencePath(packageRoots, fallbackRoot, signal.packageName, signal.filePath),
			signal.line,
			signal.signalType === "script-command" ? 10 : 8,
			"signal",
			signal.fileRole,
			`${signal.signalType} signal (${signal.fileRole}) for ${signal.dependencyName}: ${signal.value}`
		));
	}

	return buildContextBundle({
		dependencyName,
		snippetCount: snippets.length,
		signalCount: overview.signals.length,
		referenceCount: overview.references.length,
		snippets,
	}, packageName);
}

export function canRemoveDependency(
	report: AnalysisReport,
	dependencyName: string,
	packageName?: string
): RemovalAssessment {
	const overview = getDependencyOverview(report, dependencyName, packageName);

	if (!overview.isDeclared) {
		return buildRemovalAssessment({
			dependencyName,
			recommended: false,
			confidence: "low",
			riskLevel: "high",
			reason: "The dependency is not declared in the current scope, so removal cannot be assessed safely.",
			declarations: overview.declarations,
			references: overview.references,
			issues: overview.issues,
		}, packageName);
	}

	if (overview.isReferenced) {
		return buildRemovalAssessment({
			dependencyName,
			recommended: false,
			confidence: "high",
			riskLevel: "high",
			reason: "Static source references were found for this dependency, so removing it would likely break the project.",
			declarations: overview.declarations,
			references: overview.references,
			issues: overview.issues,
		}, packageName);
	}

	if (overview.isUnusedDependency) {
		const unusedClass = getUnusedClass(overview) || "unused-orphan";
		const recommended = isRemovalRecommended(unusedClass);
		return buildRemovalAssessment({
			dependencyName,
			recommended,
			confidence: unusedClass === "unused-still-installed" ? "high" : "medium",
			riskLevel: recommended
				? (unusedClass === "unused-still-installed" ? "low" : "medium")
				: "high",
			reason: REMOVAL_REASON[unusedClass],
			declarations: overview.declarations,
			references: overview.references,
			issues: overview.issues,
		}, packageName);
	}

	return buildRemovalAssessment({
		dependencyName,
		recommended: false,
		confidence: "low",
		riskLevel: "medium",
		reason: "No static references were found, but the dependency is not explicitly flagged as unused. It may still be used through scripts, config files, or framework conventions.",
		declarations: overview.declarations,
		references: overview.references,
		issues: overview.issues,
	}, packageName);
}

export function getPackageNames(report: AnalysisReport): string[] {
	if (report.kind === "project") {
		return [getDefaultSinglePackageName(report)];
	}
	return report.evidenceIndex.packages;
}

export function getProblematicPackages(
	report: AnalysisReport,
	limit: number = 5
): PackageIssueRankingView[] {
	if (report.kind === "project") {
		const summary = getSingleProjectPackageSummary(report);
		return [{
			packageName: summary.packageName,
			path: summary.path,
			issueCount: summary.issueCount,
			unusedDependencyCount: summary.unusedDependencies.length,
			ghostDependencyCount: summary.ghostDependencies.length,
			undeclaredWorkspaceDependencyCount: summary.undeclaredWorkspaceDependencies.length,
		}];
	}

	return [...report.packages]
		.map((pkg) => ({
			packageName: pkg.name,
			path: pkg.path,
			issueCount: pkg.evidence.issues.length,
			unusedDependencyCount: pkg.unusedDependencies.length,
			ghostDependencyCount: pkg.ghostDependencies.length,
			undeclaredWorkspaceDependencyCount: pkg.undeclaredWorkspaceDependencies.length,
		}))
		.sort((a, b) => {
			if (b.issueCount !== a.issueCount) {
				return b.issueCount - a.issueCount;
			}
			if (b.ghostDependencyCount !== a.ghostDependencyCount) {
				return b.ghostDependencyCount - a.ghostDependencyCount;
			}
			if (b.unusedDependencyCount !== a.unusedDependencyCount) {
				return b.unusedDependencyCount - a.unusedDependencyCount;
			}
			return a.packageName.localeCompare(b.packageName);
		})
		.slice(0, Math.max(1, limit));
}
