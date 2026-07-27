import chalk from "chalk";
import { ArgumentsCamelCase } from "yargs";
import {
	AnalysisCliArgs,
	AnalysisReport,
	Dependency,
	DependencyReviewCandidate,
	MonorepoAnalysisReport,
	PackageEvidenceChain,
	Result,
	SingleProjectAnalysisReport,
	UnusedDependencyClass,
} from "../types";
import { getDependencyReviewCandidates } from "../query";
import { ReviewPreparationSummary } from "../agent/base";
import { logInfo, logSecondary, logSuccess, logWarning } from "../utils/cli-utils";
import { getUnusedDependenciesByClass } from "./builders";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

interface UnusedClassPresentation {
	title: string;
	hint: string;
	tone: "warn" | "info";
	/** 默认是否展开明细；false 表示只给数量，--verbose 才展开。 */
	expandedByDefault: boolean;
}

const UNUSED_CLASS_PRESENTATION: Record<UnusedDependencyClass, UnusedClassPresentation> = {
	"unused-orphan": {
		title: "Unused dependencies (removing also uninstalls the package)",
		hint: "No source reference and no other installed package depends on them.",
		tone: "warn",
		expandedByDefault: true,
	},
	"unused-version-pin": {
		title: "Unused declarations that pin a version",
		hint: "Removing the declaration would change how the version resolves for other packages. Confirm before removing.",
		tone: "warn",
		expandedByDefault: true,
	},
	"unused-still-installed": {
		title: "Redundant declarations (package stays installed transitively)",
		hint: "No source reference, but other installed packages still depend on them, so removing the declaration is low risk.",
		tone: "info",
		expandedByDefault: false,
	},
	"keep-peer-requirement": {
		title: "Keep: required as a peer dependency",
		hint: "No source reference, but an installed package requires them as peer dependencies.",
		tone: "info",
		expandedByDefault: true,
	},
};

const UNUSED_CLASS_RENDER_ORDER: UnusedDependencyClass[] = [
	"unused-orphan",
	"unused-version-pin",
	"keep-peer-requirement",
	"unused-still-installed",
];

function chunkItems(items: string[], size: number): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function formatDependency(dependency: Dependency): string {
	const version = dependency.version.length > 0 ? ` @${dependency.version.join(" & @")}` : "";
	return `${dependency.name}${version}`;
}

function summarizeRequirers(dependency: Dependency): string {
	const requirers = dependency.requiredBy || [];
	if (requirers.length === 0) return "";

	const names = Array.from(new Set(requirers.map((item) => item.package)));
	const shown = names.slice(0, 3).join(", ");
	const suffix = names.length > 3 ? `, +${names.length - 3} more` : "";
	return `  <- required by ${shown}${suffix}`;
}

/**
 * 依赖名 -> 是否存在配置/工具链/脚本类弱信号。
 * 有弱信号说明它可能通过非标准方式被使用，删除前需要额外确认。
 */
function buildToolingSignalIndex(evidence?: PackageEvidenceChain): Set<string> {
	const flagged = new Set<string>();
	for (const signal of evidence?.signals || []) {
		if (
			signal.fileRole === "config"
			|| signal.fileRole === "tooling"
			|| signal.fileRole === "script"
			|| signal.signalType === "tooling-string"
			|| signal.signalType === "require-resolve"
		) {
			flagged.add(signal.dependencyName);
		}
	}
	return flagged;
}

function annotateSignals(name: string, toolingSignals: Set<string>): string {
	return toolingSignals.has(name) ? "  (has tooling/config signals)" : "";
}

function renderUnusedGroups(
	summary: Result,
	options: AnalyzeArgs,
	toolingSignals: Set<string> = new Set()
): void {
	let renderedAny = false;

	for (const unusedClass of UNUSED_CLASS_RENDER_ORDER) {
		const dependencies = getUnusedDependenciesByClass(summary, unusedClass);
		if (dependencies.length === 0) continue;

		renderedAny = true;
		const presentation = UNUSED_CLASS_PRESENTATION[unusedClass];
		const log = presentation.tone === "warn" ? logWarning : logInfo;
		log(` ${presentation.title}: ${dependencies.length}`);

		const expanded = presentation.expandedByDefault || options.verbose;
		if (!expanded) {
			logSecondary(`\t${presentation.hint} Run with --verbose to list them.`);
			continue;
		}

		logSecondary(`\t${presentation.hint}`);
		for (const dependency of dependencies) {
			logSecondary(
				`\t- ${formatDependency(dependency)}${summarizeRequirers(dependency)}${annotateSignals(dependency.name, toolingSignals)}`
			);
		}
	}

	if (!renderedAny) {
		logSuccess(` No unused runtime dependencies found`);
	}
}

export function renderAnalysisReport(report: AnalysisReport, options: AnalyzeArgs): void {
	if (report.kind === "project") {
		renderProjectAnalysisReport(report, options);
		return;
	}

	renderMonorepoAnalysisReport(report, options);
}

export function renderProjectAnalysisReport(
	report: SingleProjectAnalysisReport,
	options: AnalyzeArgs,
	reviewedCandidates: DependencyReviewCandidate[] = [],
	includeExtraInfo: boolean = true
): void {
	const result = report.summary;
	console.log("\n" + chalk.bold.green("Check Results:"));
	console.log(chalk.gray("-".repeat(50)));
	logSuccess(` Dependency check completed successfully`);
	logSuccess(
		` Analyzed ${result.totalDependencies} declared dependencies (${result.usedDependencies} referenced in source)`
	);

	if (!result.lockfile.resolved) {
		logWarning(
			` Lockfile data is unavailable, so removal risk cannot be graded: ${result.lockfile.reason}`
		);
	}

	const toolingSignals = buildToolingSignalIndex(report.evidence);

	if (reviewedCandidates.length > 0) {
		renderReviewedUnusedDependencies(result, reviewedCandidates);
	} else {
		renderUnusedGroups(result, options, toolingSignals);
	}

	if (result.typeOnlyDependencies.length > 0) {
		logInfo(` Runtime dependencies only referenced from type positions: ${result.typeOnlyDependencies.length}`);
		logSecondary(`\tThey can likely move to devDependencies.`);
		for (const dependency of result.typeOnlyDependencies) {
			logSecondary(`\t- ${dependency.name}`);
		}
	}

	if (result.devDependencies.length > 0) {
		logInfo(` Unused devDependencies: ${result.devDependencies.length}`);
		if (options.verbose) {
			for (const dependency of result.devDependencies) {
				logSecondary(
					`\t- ${formatDependency(dependency)}${annotateSignals(dependency.name, toolingSignals)}`
				);
			}
		} else {
			logSecondary(`\tRun with --verbose to list them.`);
		}
	}

	if (result.dynamicImports.length > 0) {
		logInfo(` Dynamic imports that cannot be resolved statically: ${result.dynamicImports.length}`);
		for (const item of result.dynamicImports) {
			logSecondary(`\t- ${item.filePath}:${item.line}  ${item.expression}`);
		}
	}

	if (includeExtraInfo) {
		renderProjectExtraInfo(report, options);
	}
}

function renderReviewedUnusedDependencies(
	result: Result,
	reviewedCandidates: DependencyReviewCandidate[]
): void {
	const candidateByName = new Map(
		reviewedCandidates.map((candidate) => [candidate.dependencyName, candidate])
	);
	const unusedNames = result.unusedDependencies.map((dependency) => dependency.name);

	const highConfidenceUnused = unusedNames.filter((name) => {
		const candidate = candidateByName.get(name);
		return !candidate || candidate.disposition === "high-confidence-unused";
	});
	const likelyIndirectUsage = unusedNames.filter((name) => {
		const candidate = candidateByName.get(name);
		return candidate?.disposition === "likely-tooling-usage" || candidate?.disposition === "confirmed-used";
	});
	const needsReview = unusedNames.filter(
		(name) => candidateByName.get(name)?.disposition === "needs-review"
	);

	logInfo(` Static screening found ${unusedNames.length} unused dependency candidates`);

	if (highConfidenceUnused.length > 0) {
		logSuccess(` High-confidence unused dependencies: ${highConfidenceUnused.length}`);
		for (const name of highConfidenceUnused) {
			const dependency = result.unusedDependencies.find((item) => item.name === name);
			logSecondary(`\t- ${dependency ? formatDependency(dependency) : name}`);
		}
	} else {
		logSuccess(` No high-confidence unused dependencies found after AI review`);
	}

	if (likelyIndirectUsage.length > 0) {
		logWarning(` Likely indirect or tooling-managed dependencies: ${likelyIndirectUsage.length}`);
		likelyIndirectUsage.forEach((name) => logSecondary(`\t- ${name}`));
	}

	if (needsReview.length > 0) {
		logWarning(` Dependencies that still need manual review: ${needsReview.length}`);
		needsReview.forEach((name) => logSecondary(`\t- ${name}`));
	}
}

export function renderProjectResult(result: Result, options: AnalyzeArgs): void {
	const emptyEvidence: PackageEvidenceChain = {
		declarations: [],
		references: [],
		issues: [],
		signals: [],
	};

	renderProjectAnalysisReport(
		{ kind: "project", path: options.path, summary: result, evidence: emptyEvidence },
		options
	);
}

export function renderProjectExtraInfo(
	report: SingleProjectAnalysisReport,
	options: AnalyzeArgs
): void {
	const result = report.summary;
	console.log("\n" + chalk.bold.green("Some extra info:"));
	console.log(chalk.gray("-".repeat(50)));

	const hasIgnoreRules =
		options.config !== ""
		|| options.ignoreDep !== ""
		|| options.ignorePath !== ""
		|| options.ignoreFile !== "";

	if (result.unusedDependenciesCount > 0 && !hasIgnoreRules && !options.silence) {
		logWarning(` Due to workload reasons, Deplens cannot fully support all frameworks and plugins.`);
		logWarning(
			` If there are false positives, please record them in [ deplens.config.json ] or '--ignore' option .`
		);
	}

	if (options.verbose) {
		logInfo(` Verbose output enabled`);
	} else if (!options.silence) {
		logInfo(` Run with --verbose for detailed output`);
	}
}

export function renderMonorepoAnalysisReport(
	report: MonorepoAnalysisReport,
	options: AnalyzeArgs
): void {
	const packagesWithUnusedDeps = report.packages.filter((pkg) => pkg.unusedDependencies.length > 0);
	const packagesWithoutUnusedDeps = report.packages.filter(
		(pkg) => pkg.unusedDependencies.length === 0
	);
	const packagesWithGhostDeps = report.packages.filter((pkg) => pkg.ghostDependencies.length > 0);
	const compactPackageNames = packagesWithoutUnusedDeps
		.map((pkg) => pkg.name)
		.sort((a, b) => a.localeCompare(b));

	console.log("\n" + chalk.bold.green("Monorepo Check Results:"));
	console.log(chalk.gray("-".repeat(50)));
	logSuccess(` Monorepo type: ${report.monorepoType}`);
	logSuccess(` Workspace packages analyzed: ${report.packageCount}`);
	logInfo(` Project root: ${report.projectPath}`);
	logInfo(` Packages with unused dependencies: ${packagesWithUnusedDeps.length}`);
	logInfo(` Packages with ghost dependencies: ${packagesWithGhostDeps.length}`);
	logInfo(` Packages without unused dependencies: ${packagesWithoutUnusedDeps.length}`);

	if (compactPackageNames.length > 0) {
		console.log("\n" + chalk.bold.green("Packages Without Unused Dependencies:"));
		console.log(chalk.gray("-".repeat(50)));
		for (const chunk of chunkItems(compactPackageNames, 6)) {
			logSecondary(`\t- ${chunk.join(", ")}`);
		}
	}

	// 只要有未使用依赖或幽灵依赖就要展开明细。
	// 旧实现在「没有未使用依赖」时直接 return，导致上面刚报了幽灵依赖数量却从不列出具体内容。
	const packagesToDetail = report.packages.filter(
		(pkg) => pkg.unusedDependencies.length > 0 || pkg.ghostDependencies.length > 0
	);

	if (packagesToDetail.length === 0) {
		logSuccess(` No workspace package contains unused or ghost dependencies`);
		return;
	}

	console.log("\n" + chalk.bold.green("Package Details:"));
	console.log(chalk.gray("-".repeat(50)));

	for (const pkg of packagesToDetail) {
		console.log("\n" + chalk.bold.cyan(`${pkg.name}  (${pkg.path})`));
		console.log(chalk.gray("-".repeat(50)));

		logInfo(` Declared dependencies: ${pkg.declaredDependencies.length}`);
		logInfo(` Referenced external packages: ${pkg.usedImports.length}`);

		if (!pkg.summary.lockfile.resolved) {
			logWarning(` Lockfile data unavailable, removal risk is not graded for this package`);
		}

		renderUnusedGroups(pkg.summary, options, buildToolingSignalIndex(pkg.evidence));

		if (pkg.dynamicImports.length > 0) {
			logInfo(` Dynamic imports skipped: ${pkg.dynamicImports.length}`);
		}

		if (pkg.workspaceDependencies.length > 0) {
			logInfo(` Workspace references: ${pkg.workspaceDependencies.length}`);
			for (const dependency of pkg.workspaceDependencies) {
				const declared = pkg.declaredDependencies.includes(dependency);
				logSecondary(`\t- ${dependency}${declared ? "" : " (undeclared)"}`);
			}
		}

		if (pkg.ghostDependencies.length > 0) {
			logWarning(` Ghost dependencies: ${pkg.ghostDependencies.length}`);
			logSecondary(`\tReferenced in source but not declared in this package's manifest.`);
			for (const dependency of pkg.ghostDependencies) {
				logSecondary(`\t- ${dependency}`);
			}
		}
	}
}

export function renderCheckReviewHints(
	report: AnalysisReport,
	reviewSummary?: ReviewPreparationSummary,
	reviewedCandidates: DependencyReviewCandidate[] = []
): void {
	const candidates = reviewedCandidates.length > 0
		? reviewedCandidates
		: getDependencyReviewCandidates(report).filter((candidate) =>
			candidate.disposition === "needs-review"
			|| candidate.disposition === "likely-tooling-usage"
			|| candidate.disposition === "ghost-dependency"
		);

	if (candidates.length === 0) {
		return;
	}

	const sample = (predicate: (candidate: DependencyReviewCandidate) => boolean) =>
		candidates
			.filter(predicate)
			.slice(0, 8)
			.map((candidate) => candidate.packageName
				? `${candidate.dependencyName} (${candidate.packageName})`
				: candidate.dependencyName);

	console.log("\n" + chalk.bold.green("Review Hints:"));
	console.log(chalk.gray("-".repeat(50)));

	if (reviewSummary) {
		logInfo(` AI review checked ${reviewSummary.reviewedCandidateCount} suspicious unused-dependency candidates`);
		logInfo(` Reclassified as likely tooling or indirect usage: ${reviewSummary.likelyToolingUsageCount}`);
		logInfo(` Still ambiguous after review: ${reviewSummary.needsReviewCount}`);
		logInfo(` Reclassified as confirmed used: ${reviewSummary.confirmedUsedCount}`);
	} else {
		logWarning(` Found ${candidates.length} low-confidence dependency candidates that may use non-standard import paths, scripts, or tooling configuration.`);
		logWarning(` Treat unused dependency results as coarse screening only before uninstalling anything.`);
		logInfo(` Use 'deplens check --review' to run AI second-pass review, or ask about a specific dependency in chat mode.`);
	}

	const likelyTooling = sample((candidate) => candidate.disposition === "likely-tooling-usage");
	if (likelyTooling.length > 0) {
		logInfo(` Likely tooling/config usage samples:`);
		likelyTooling.forEach((item) => logSecondary(`\t- ${item}`));
	}

	const needsReview = sample((candidate) => candidate.disposition === "needs-review");
	if (needsReview.length > 0) {
		logInfo(` Needs manual review samples:`);
		needsReview.forEach((item) => logSecondary(`\t- ${item}`));
	}
}
