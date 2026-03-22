import fs from "fs";
import glob from "fast-glob";
import { ArgumentsCamelCase } from "yargs";
import { transpileToStandardJS } from "../utils/transpiler";
import { minifyCode } from "../utils/minifier";
import { logInQueue } from "../utils/logQueue";
import { AnalysisCliArgs, ScannedSourceFile } from "../types";

const { parse, compileScript } = require("@vue/compiler-sfc");

type ScanArgs = ArgumentsCamelCase<AnalysisCliArgs>;

function resolveIgnoreList(args: ScanArgs): string[] {
	let ignoreList: string[] = [];

	if (args.config !== "" || fs.existsSync(`${args.path}/deplens.config.json`)) {
		const configPath = args.config || `${args.path}/deplens.config.json`;
		const config = fs.readFileSync(configPath, "utf8");
		const configArray = JSON.parse(config);
		const ignorePath = configArray.ignorePath || [];
		const ignorePathPatterns = ignorePath.map((item: string) => `**${item.trim()}/**`);
		const ignoreFile = configArray.ignoreFile || [];
		const ignoreFilePatterns = ignoreFile.map((item: string) => `**${item.trim()}/**`);
		ignoreList = [...ignoreList, ...ignorePathPatterns, ...ignoreFilePatterns];
	}

	if (args.ignoreDep !== "") {
		const ignoreDepPatterns = args.ignoreDep
			.split(/[\s,]+/)
			.map((item) => `**${item.trim()}/**`);
		ignoreList = [...ignoreList, ...ignoreDepPatterns];
	}

	if (args.ignorePath !== "") {
		const ignorePathPatterns = args.ignorePath
			.split(/[\s,]+/)
			.map((item) => `**${item.trim()}/**`);
		ignoreList = [...ignoreList, ...ignorePathPatterns];
	}

	if (args.ignoreFile !== "") {
		const ignoreFilePatterns = args.ignoreFile
			.split(/[\s,]+/)
			.map((item) => `**${item.trim()}/**`);
		ignoreList = [...ignoreList, ...ignoreFilePatterns];
	}

	return ignoreList;
}

async function discoverSourceFiles(args: ScanArgs): Promise<string[]> {
	const ignoreList = resolveIgnoreList(args);
	return glob(["**/*.{js,jsx,ts,tsx,mjs,cjs,vue}"], {
		cwd: args.path,
		ignore: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.git/**",
			"**/*.d.ts",
			...ignoreList,
		],
	});
}

async function transformSourceFile(
	args: ScanArgs,
	relativeFilePath: string
): Promise<ScannedSourceFile> {
	const separator = process.platform === "win32" ? "\\" : "/";
	const fileExtension = relativeFilePath.split(".").pop();
	const normalizedFilePath = relativeFilePath.replace(/\//g, separator);
	const fullPath = `${args.path}${separator}${normalizedFilePath}`;

	let content = fs.readFileSync(fullPath, "utf-8");
	if (fileExtension === "vue") {
		const { descriptor, errors } = parse(content, {
			filename: normalizedFilePath,
		});

		if (errors.length > 0) {
			throw new Error(`Failed to parse Vue SFC ${normalizedFilePath}: ${errors}`);
		}

		if (descriptor.script || descriptor.scriptSetup) {
			const compiledScript = compileScript(descriptor, {
				id: normalizedFilePath,
			});
			content = compiledScript.content;
		}
	}

	const standardJS = (await transpileToStandardJS(content, args.path, normalizedFilePath)) ?? "";
	return {
		path: normalizedFilePath.replace(/\\/g, "/"),
		code: standardJS,
	};
}

export async function readProjectSourceFiles(args: ScanArgs): Promise<ScannedSourceFile[]> {
	const files = await discoverSourceFiles(args);
	const sourceFiles: ScannedSourceFile[] = [];
	let errorCount = 0;

	for (const file of files) {
		try {
			const sourceFile = await transformSourceFile(args, file);
			sourceFiles.push(sourceFile);
		} catch (error) {
			if (args.verbose) {
				logInQueue(` Error: Failed to read file ${file}. Error: ${error}`, "error");
			} else {
				errorCount++;
			}
		}
	}

	if (errorCount > 0 && !args.verbose) {
		logInQueue(
			` Warning: ${errorCount} files read failed. Try to use \`--verbose\` to see more details.`,
			"warn"
		);
	}

	return sourceFiles;
}

export async function scan(args: ScanArgs): Promise<string[]> {
	const sourceFiles = await readProjectSourceFiles(args);
	const fileList: string[] = [];

	for (const sourceFile of sourceFiles) {
		const minifiedJS = (await minifyCode(sourceFile.code)) ?? "";
		fileList.push(minifiedJS);
	}

	return fileList;
}
