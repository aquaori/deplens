import fs from "fs";
import path from "path";
import glob from "fast-glob";
import { ArgumentsCamelCase } from "yargs";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { AnalysisCliArgs, ScanError, ScanResult, ScannedSourceFile, SourceBlock } from "../types";
import { resolveIgnoreRules } from "../config/ignore";

type ScanArgs = ArgumentsCamelCase<AnalysisCliArgs>;

const SOURCE_GLOB = "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue}";

const DEFAULT_IGNORE = [
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/.git/**",
	"**/*.d.ts",
];

/**
 * 把用户给的一条 ignore 值展开成 fast-glob 能匹配到的多种形态。
 *
 * 旧实现只生成 `**<item>/**`，导致 `--ignoreFile b.ts` 这类裸文件名永远匹配不到，
 * 且 `**src/**` 里的 `**` 不是完整路径段、无法匹配嵌套目录。
 */
function toIgnorePatterns(rawItem: string): string[] {
	const item = rawItem.trim().replace(/^[./\\]+/, "").replace(/[/\\]+$/, "");
	if (item === "") return [];

	const normalized = item.replace(/\\/g, "/");
	return [
		normalized,
		`${normalized}/**`,
		`**/${normalized}`,
		`**/${normalized}/**`,
	];
}

function resolveIgnoreList(args: ScanArgs): string[] {
	const rules = resolveIgnoreRules(args);
	const ignoreList: string[] = [];

	for (const item of [...rules.paths, ...rules.files]) {
		ignoreList.push(...toIgnorePatterns(item));
	}

	return Array.from(new Set(ignoreList));
}

async function discoverSourceFiles(args: ScanArgs): Promise<string[]> {
	return glob([SOURCE_GLOB], {
		cwd: args.path,
		ignore: [...DEFAULT_IGNORE, ...resolveIgnoreList(args)],
	});
}

/**
 * 从 .vue SFC 中取出 script 块。
 *
 * 这里刻意读取原始块内容而不是 compileScript 的产物：原始块本身就是合法的 JS/TS，
 * 包含全部 import，而且配合块起始行号可以让证据行号准确指回 .vue 文件本身。
 */
function extractVueBlocks(relativePath: string, content: string): SourceBlock[] {
	const { descriptor, errors } = parseSfc(content, { filename: relativePath });

	if (errors.length > 0) {
		const message = errors.map((item) => (item instanceof Error ? item.message : String(item))).join("; ");
		throw new Error(`Failed to parse Vue SFC: ${message}`);
	}

	const blocks: SourceBlock[] = [];
	for (const block of [descriptor.script, descriptor.scriptSetup]) {
		if (!block || typeof block.content !== "string" || block.content.trim() === "") continue;
		blocks.push({
			code: block.content,
			// block.loc.start.line 是 <script> 标签所在行，块内容从下一行开始。
			lineOffset: Math.max(0, (block.loc?.start?.line ?? 1) - 1),
		});
	}

	return blocks;
}

function readSourceFile(projectPath: string, relativeFilePath: string): ScannedSourceFile {
	const normalizedRelativePath = relativeFilePath.replace(/\\/g, "/");
	const absolutePath = path.resolve(projectPath, normalizedRelativePath);
	const originalCode = fs.readFileSync(absolutePath, "utf-8");
	const isVue = normalizedRelativePath.toLowerCase().endsWith(".vue");

	return {
		path: normalizedRelativePath,
		absolutePath,
		originalCode,
		blocks: isVue
			? extractVueBlocks(normalizedRelativePath, originalCode)
			: [{ code: originalCode, lineOffset: 0 }],
	};
}

/**
 * 扫描项目源码。
 *
 * 与旧实现的两点区别：
 *  1. 不再做 Babel 转译和 terser 压缩 —— 引用检测只需要原始源码的 AST，
 *     转译反而会剥掉 type-only import、压缩则会丢掉全部行列信息。
 *  2. 读取失败以结构化列表返回，不再塞进一个只在特定路径才会被冲刷的日志队列。
 */
export async function scanProjectSources(args: ScanArgs): Promise<ScanResult> {
	const files = await discoverSourceFiles(args);
	const sourceFiles: ScannedSourceFile[] = [];
	const errors: ScanError[] = [];

	for (const file of files) {
		try {
			sourceFiles.push(readSourceFile(args.path, file));
		} catch (error) {
			errors.push({
				path: file.replace(/\\/g, "/"),
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { files: sourceFiles, errors };
}
