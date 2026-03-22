import chalk from "chalk";
import fs from "fs";
import { ArgumentsCamelCase } from "yargs";
import {
	AnalysisCliArgs,
	AnalysisReport,
	DependencyReviewCandidate,
	MonorepoAnalysisReport,
	PackageEvidenceChain,
	Result,
	SingleProjectAnalysisReport,
} from "../types";
import { getDependencyReviewCandidates } from "../query";
import { ReviewPreparationSummary } from "../agent/base";
import { logInfo, logSecondary, logSuccess, logWarning } from "../utils/cli-utils";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

function chunkItems(items: string[], size: number): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

export function renderAnalysisReport(
	report: AnalysisReport,
	options: AnalyzeArgs
): void {
	if (report.kind === "project") {
		renderProjectAnalysisReport(report, options);
		return;
	}

	renderMonorepoAnalysisReport(report);
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
	logSuccess(` Analyzed ${result.totalDependencies} packages`);

	if (reviewedCandidates.length > 0) {
		const candidateByName = new Map(reviewedCandidates.map((candidate) => [candidate.dependencyName, candidate]));
		const staticUnused = result.unusedDependencies
			.filter((dep) => dep.type !== "dynamic" && !dep.args && dep.name)
			.map((dep) => dep.name)
			.filter((name): name is string => Boolean(name));
		const highConfidenceUnused = staticUnused.filter((name) => {
			const candidate = candidateByName.get(name);
			return !candidate || candidate.disposition === "high-confidence-unused";
		});
		const likelyIndirectUsage = staticUnused.filter((name) => {
			const candidate = candidateByName.get(name);
			return candidate?.disposition === "likely-tooling-usage" || candidate?.disposition === "confirmed-used";
		});
		const needsReview = staticUnused.filter((name) => {
			const candidate = candidateByName.get(name);
			return candidate?.disposition === "needs-review";
		});

		logInfo(` Static screening found ${staticUnused.length} unused dependency candidates`);
		if (highConfidenceUnused.length > 0) {
			logSuccess(` High-confidence unused dependencies: ${highConfidenceUnused.length}`);
			highConfidenceUnused.forEach((dependencyName) => {
				const dependency = result.unusedDependencies.find((dep) => dep.name === dependencyName);
				logSecondary(`\t- ${dependencyName}${dependency?.version ? ` @${(dependency.version as string[]).join(" & @")}` : ""}`);
			});
		} else {
			logSuccess(` No high-confidence unused dependencies found after AI pre-review`);
		}
		if (likelyIndirectUsage.length > 0) {
			logWarning(` Likely indirect or tooling-managed dependencies: ${likelyIndirectUsage.length}`);
			likelyIndirectUsage.forEach((dependencyName) => {
				logSecondary(`\t- ${dependencyName}`);
			});
		}
		if (needsReview.length > 0) {
			logWarning(` Dependencies that still need manual review: ${needsReview.length}`);
			needsReview.forEach((dependencyName) => {
				logSecondary(`\t- ${dependencyName}`);
			});
		}
	} else {
		if (result.ununsedDependenciesCount > 0) {
			logInfo(` Found ${result.ununsedDependenciesCount} unused dependencies : `);
		} else {
			logSuccess(` No unused dependencies found`);
		}

		result.unusedDependencies.forEach((dep) => {
			if (dep.type !== "dynamic" && !dep.args) {
				logSecondary(
					`\t- ${dep.name}${dep.version ? ` @${(dep.version as string[]).join(" & @")}` : ""}`
				);
			}
		});
	}

	const hasDynamic = result.unusedDependencies.some((dep) => dep.type === "dynamic");

	if (hasDynamic) {
		logInfo(
			` Found ${result.unusedDependencies.filter((dep) => dep.type === "dynamic").length} dynamic imports that deplens cannot analyze: `
		);
		result.unusedDependencies
			.filter((dep) => dep.type === "dynamic")
			.forEach((dep) => {
				logSecondary(`\t- ${dep.args}`);
			});
	}

	if (options.verbose) {
		if (result.devDependencies.length > 0) {
			logInfo(
				` Found ${result.devDependencies.length} dev dependencies that you maybe don't need them in stable environment : `
			);
		} else {
			logSuccess(` No dev dependencies found`);
		}
		result.devDependencies.forEach((dep) => {
			logSecondary(`\t- ${dep.name}`);
		});
	}

	if (includeExtraInfo) {
		renderProjectExtraInfo(report, options);
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
		{
			kind: "project",
			path: options.path,
			summary: result,
			evidence: emptyEvidence,
		},
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

	if (
		result.ununsedDependenciesCount > 0 &&
		options.config === "" &&
		(options.ignoreDep === "" || options.ignorePath === "" || options.ignoreFile === "") &&
		!fs.existsSync(`${options.path}/deplens.config.json`) &&
		!options.silence
	) {
		logWarning(
			` Due to workload reasons, Deplens cannot fully support all frameworks and plugins.`
		);
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

export function renderMonorepoAnalysisReport(report: MonorepoAnalysisReport): void {
	const packagesWithUnusedDeps = report.packages.filter(
		(pkg) => pkg.unusedDependencies.length > 0
	);
	const packagesWithoutUnusedDeps = report.packages.filter(
		(pkg) => pkg.unusedDependencies.length === 0
	);
	const packagesWithGhostDeps = report.packages.filter(
		(pkg) => pkg.ghostDependencies.length > 0
	);
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

	if (packagesWithUnusedDeps.length === 0) {
		logSuccess(` No workspace package contains unused dependencies`);
		return;
	}

	console.log("\n" + chalk.bold.green("Packages With Unused Dependencies:"));
	console.log(chalk.gray("-".repeat(50)));

	for (const pkg of packagesWithUnusedDeps) {
		console.log("\n" + chalk.bold.cyan(`${pkg.name}  (${pkg.path})`));
		console.log(chalk.gray("-".repeat(50)));

		logInfo(` Declared dependencies: ${pkg.declaredDependencies.length}`);
		logInfo(` Referenced external packages: ${pkg.usedImports.length}`);

		logWarning(` Unused dependencies: ${pkg.unusedDependencies.length}`);
		pkg.unusedDependencies.forEach((dependencyName) => {
			logSecondary(`\t- ${dependencyName}`);
		});

		if (pkg.dynamicUnusedDependencies.length > 0) {
			logInfo(` Dynamic imports skipped: ${pkg.dynamicUnusedDependencies.length}`);
		}

		if (pkg.workspaceDependencies.length > 0) {
			logInfo(` Workspace references: ${pkg.workspaceDependencies.length}`);
			pkg.workspaceDependencies.forEach((dependency) => {
				const declared = pkg.declaredDependencies.includes(dependency);
				logSecondary(`\t- ${dependency}${declared ? "" : " (undeclared)"}`);
			});
		}

		if (pkg.ghostDependencies.length > 0) {
			logWarning(` Ghost dependencies: ${pkg.ghostDependencies.length}`);
			pkg.ghostDependencies.forEach((dependency) => {
				logSecondary(`\t- ${dependency}`);
			});
		}
	}
}

export function renderCheckReviewHints(
	report: AnalysisReport,
	preReviewSummary?: ReviewPreparationSummary,
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

	if (preReviewSummary) {
		logInfo(` AI pre-review checked ${preReviewSummary.reviewedCandidateCount} suspicious unused-dependency candidates`);
		logInfo(` Reclassified as likely tooling or indirect usage: ${preReviewSummary.likelyToolingUsageCount}`);
		logInfo(` Still ambiguous after review: ${preReviewSummary.needsReviewCount}`);
		logInfo(` Reclassified as confirmed used: ${preReviewSummary.confirmedUsedCount}`);
	} else {
		logWarning(` Found ${candidates.length} low-confidence dependency candidates that may use non-standard import paths, scripts, or tooling configuration.`);
		logWarning(` Treat unused dependency results as coarse screening only before uninstalling anything.`);
		logInfo(` Use 'deplens check --preReview' to run AI second-pass review, or ask about a specific dependency in review mode.`);
	}

	const likelyTooling = sample((candidate) => candidate.disposition === "likely-tooling-usage");
	if (likelyTooling.length > 0) {
		logInfo(` Likely tooling/config usage samples:`);
		likelyTooling.forEach((item) => {
			logSecondary(`\t- ${item}`);
		});
	}

	const needsReview = sample((candidate) => candidate.disposition === "needs-review");
	if (needsReview.length > 0) {
		logInfo(` Needs manual review samples:`);
		needsReview.forEach((item) => {
			logSecondary(`\t- ${item}`);
		});
	}
}
