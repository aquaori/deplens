import fs from "fs";
import path from "path";
import { ArgumentsCamelCase } from "yargs";
import { AnalysisCliArgs, AnalysisReport } from "../types";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

export function outputJsonReport(report: AnalysisReport, args: AnalyzeArgs): void {
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
