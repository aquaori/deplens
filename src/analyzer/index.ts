import { ArgumentsCamelCase } from "yargs";
import { AnalysisCliArgs, AnalysisReport, Dependency, Result } from "../types";
import { scan } from "../analyzer/scanner";
import { parseAST } from "../analyzer/parser";
import { getDependencies, parseDependencies, summaryData } from "../analyzer/dependency";
import cliProgress from "cli-progress";
import { spitOutQueue } from "../utils/logQueue";
import { isMonorepo, monorepoMode } from "../driver/monorepo";
import { logInfo } from "../utils/cli-utils";
import { buildProjectAnalysisReport } from "../report/builders";
import { outputJsonReport } from "../report/output";
import { renderAnalysisReport, renderProjectResult } from "../report/renderers";
import { buildPackageEvidenceChain } from "../evidence";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

export async function analyzeProject(
	args: AnalyzeArgs,
	showResult: boolean = true
): Promise<[] | AnalysisReport> {
	if (isMonorepo(args.path)) {
		if (!args.silence) {
			logInfo(` Monorepo detected, transiting to monorepo mode`);
		}
		const monorepoReport = await monorepoMode(args, runProjectAnalysis);
		if (showResult) {
			if (args.json) {
				outputJsonReport(monorepoReport, args);
				return monorepoReport;
			}
			renderAnalysisReport(monorepoReport, args);
			const emptyResult: [] = [];
			return emptyResult;
		}
		return monorepoReport;
	}

	const summary = await runProjectAnalysis(args);
	const evidence = await buildPackageEvidenceChain({
		args,
		summary,
	});
	const report = buildProjectAnalysisReport(args.path, summary, evidence);

	if (showResult) {
		if (args.json) {
			outputJsonReport(report, args);
			return report;
		}

		renderAnalysisReport(report, args);
		const emptyResult: [] = [];
		return emptyResult;
	}

	return report;
}

export async function runProjectAnalysis(args: AnalyzeArgs): Promise<Result> {

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
	return summary;
}

export function displayResults(
	result: Result,
	options: AnalyzeArgs
): void {
	renderProjectResult(result, options);
}
