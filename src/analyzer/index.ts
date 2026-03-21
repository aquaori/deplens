import { logInfo, logSuccess, logWarning, logSecondary } from "../utils/cli-utils";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { ArgumentsCamelCase } from "yargs";
import { AnalysisReport, Dependency, Result } from "../types";
import { scan } from "../analyzer/scanner";
import { parseAST } from "../analyzer/parser";
import { getDependencies, parseDependencies, summaryData } from "../analyzer/dependency";
import cliProgress from "cli-progress";
import { spitOutQueue } from "../utils/logQueue";
import { isMonorepo, monorepoMode } from "../driver/monorepo";

type AnalyzeArgs = ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	silence: boolean;
	ignoreDep: string;
	ignorePath: string;
	ignoreFile: string;
	config: string;
	json: boolean;
	output: string;
}>;

export async function analyzeProject(
	args: AnalyzeArgs,
	showResult: boolean = true
): Promise<[] | [Result, AnalyzeArgs] | AnalysisReport> {
	if (isMonorepo(args.path)) {
		if (!args.silence) {
			logInfo(` Monorepo detected, transiting to monorepo mode`);
		}
		const monorepoResult = await monorepoMode(args, analyzeProject);
		if (showResult && args.json && !Array.isArray(monorepoResult)) {
			outputJsonReport(monorepoResult, args);
		}
		return monorepoResult;
	}

	let bar1: cliProgress.SingleBar | null = null;
	if (!args.silence) {
		bar1 = new cliProgress.SingleBar(
			{
				clearOnComplete: true,
				hideCursor: true,
				format: " {bar} | {stepname} | {value}/{total}",
			},
			cliProgress.Presets.shades_classic
		);
		bar1.start(4, 0, { stepname: "Initializing..." });
	}

	const fileContentList = await scan(args);
	if (!args.silence && bar1) bar1.increment({ stepname: "Scanning files" });

	const astList = await parseAST(fileContentList as string[]);
	if (!args.silence && bar1) bar1.increment({ stepname: "Parsing AST" });

	const [systemDeps, checkCount] = await getDependencies(args, 0);
	await parseDependencies(astList, systemDeps as Dependency[]);
	if (!args.silence && bar1) bar1.increment({ stepname: "Analyzing dependencies" });

	const summary = summaryData(systemDeps as Dependency[], checkCount as number) as Result;
	if (!args.silence && bar1) bar1.increment({ stepname: "Summarizing results" });

	if (!args.silence && bar1) {
		bar1.stop();
		spitOutQueue();
	}

	if (showResult && !args.silence) {
		logSuccess(` Dependencies checking Successfully`);
	}

	if (showResult) {
		if (args.json) {
			const report: AnalysisReport = {
				kind: "project",
				path: args.path,
				summary,
			};
			outputJsonReport(report, args);
			return report;
		}
		displayResults(summary, args);
		const emptyResult: [] = [];
		return emptyResult;
	}
	return [summary, args];
}

function outputJsonReport(report: AnalysisReport, args: AnalyzeArgs) {
	const json = JSON.stringify(report, null, 2);
	if (args.output !== "") {
		const outputPath = path.isAbsolute(args.output)
			? args.output
			: path.resolve(process.cwd(), args.output);
		fs.writeFileSync(outputPath, json, "utf-8");
		return;
	}
	process.stdout.write(`${json}\n`);
}

export function displayResults(
	result: Result,
	options: AnalyzeArgs
): void {
	console.log("\n" + chalk.bold.green("Check Results:"));
	console.log(chalk.gray("-".repeat(50)));
	logSuccess(` Dependency check completed successfully`);
	logSuccess(` Analyzed ${result.totalDependencies} packages`);

	if (result.ununsedDependenciesCount > 0) {
		logInfo(` Found ${result.ununsedDependenciesCount} unused dependencies : `);
	} else {
		logSuccess(` No unused dependencies found`);
	}

	let hasDynamic = false;
	result.unusedDependencies.forEach((dep) => {
		if (dep.type !== "dynamic" && !dep.args) {
			logSecondary(
				`\t- ${dep.name}${dep.version ? ` @${(dep.version as any).join(" & @")}` : ""}`
			);
		} else {
			hasDynamic = true;
		}
	});

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

	console.log("\n" + chalk.bold.green("Some extra info:"));
	console.log(chalk.gray("-".repeat(50)));

	if (
		result.ununsedDependenciesCount > 0 &&
		options["config"] === "" &&
		(options["ignoreDep"] === "" ||
			options["ignorePath"] === "" ||
			options["ignoreFile"] === "") &&
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
