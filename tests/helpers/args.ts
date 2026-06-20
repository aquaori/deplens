import { ArgumentsCamelCase } from "yargs";
import { AnalysisCliArgs } from "../../src/types";

export function createAnalyzeArgs(
	path: string,
	overrides: Partial<AnalysisCliArgs> = {}
): ArgumentsCamelCase<AnalysisCliArgs> {
	return {
		path,
		verbose: false,
		silence: true,
		ignoreDep: "",
		ignorePath: "",
		ignoreFile: "",
		config: "",
		json: false,
		output: "",
		html: false,
		review: false,
		...overrides,
		_: [],
		$0: "deplens",
	} as ArgumentsCamelCase<AnalysisCliArgs>;
}
