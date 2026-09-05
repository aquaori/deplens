import { parse, ParserPlugin } from "@babel/parser";
import { ParsedSourceBlock, ScanError, ScannedSourceFile } from "../types";

function shouldRetryWithDeprecatedImportAssert(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.message.includes("deprecatedImportAssert")
		|| error.message.includes("assert keyword in import attributes is deprecated")
		|| error.message.includes("has been replaced by the `with` keyword");
}

function buildParserPlugins(useDeprecatedImportAssert: boolean, allowJsx: boolean): ParserPlugin[] {
	return [
		...(allowJsx ? ["jsx" as ParserPlugin] : []),
		"typescript",
		"decorators-legacy",
		"classProperties",
		"explicitResourceManagement",
		useDeprecatedImportAssert ? "deprecatedImportAssert" : "importAttributes",
	];
}

function parseBlock(code: string, sourceFilename: string) {
	const allowJsx = /\.(jsx|tsx|vue)$/i.test(sourceFilename);
	try {
		return parse(code, {
			sourceType: "unambiguous",
			sourceFilename,
			allowImportExportEverywhere: true,
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: true,
			errorRecovery: true,
			plugins: buildParserPlugins(false, allowJsx),
		});
	} catch (error) {
		if (!shouldRetryWithDeprecatedImportAssert(error)) {
			throw error;
		}

		return parse(code, {
			sourceType: "unambiguous",
			sourceFilename,
			allowImportExportEverywhere: true,
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: true,
			errorRecovery: true,
			plugins: buildParserPlugins(true, allowJsx),
		});
	}
}

export interface ParseSourcesResult {
	blocks: ParsedSourceBlock[];
	errors: ScanError[];
}

/**
 * 把扫描到的源码块解析成 AST，并保留文件归属与行号偏移。
 *
 * 旧实现返回的是一个没有文件归属的裸 AST 数组，导致下游既无法报出问题所在文件，
 * 也无法产出行列证据 —— 这正是「用法检测」被迫写成两套实现的根因。
 */
export function parseSources(files: ScannedSourceFile[]): ParseSourcesResult {
	const blocks: ParsedSourceBlock[] = [];
	const errors: ScanError[] = [];

	for (const file of files) {
		for (const block of file.blocks) {
			if (typeof block.code !== "string") continue;
			try {
				const ast = parseBlock(block.code, file.path);
				blocks.push({ file, ast, code: block.code, lineOffset: block.lineOffset });

				// errorRecovery 让我们能从局部语法错误的文件里照样提取出 import，
				// 但恢复过的错误必须显式上报，不能让「部分解析」看起来像「完整解析」。
				const recovered = (ast as { errors?: Array<{ message?: string }> }).errors;
				if (Array.isArray(recovered) && recovered.length > 0) {
					errors.push({
						path: file.path,
						message: `Recovered from ${recovered.length} syntax error(s); results for this file may be incomplete. First: ${recovered[0]?.message || "unknown"}`,
					});
				}
			} catch (error) {
				errors.push({
					path: file.path,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	return { blocks, errors };
}
