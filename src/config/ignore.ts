import fs from "fs";
import path from "path";
import { ArgumentsCamelCase } from "yargs";
import { AnalysisCliArgs } from "../types";

type IgnoreArgs = ArgumentsCamelCase<AnalysisCliArgs>;

export interface IgnoreRules {
	paths: string[];
	files: string[];
	dependencies: string[];
}

function splitCliValue(value: string | undefined): string[] {
	if (typeof value !== "string") return [];
	return value.split(/[\s,]+/).map((item) => item.trim()).filter((item) => item !== "");
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
	const value = source[key];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
}

export function resolveProjectConfigPath(args: IgnoreArgs): string | null {
	const explicitPath = (args.config || "").trim();
	if (explicitPath !== "") {
		if (!fs.existsSync(explicitPath)) {
			throw new Error(`The config file ${explicitPath} does not exist.`);
		}
		return explicitPath;
	}

	const defaultPath = path.join(args.path, "deplens.config.json");
	return fs.existsSync(defaultPath) ? defaultPath : null;
}

export function readProjectConfig(args: IgnoreArgs): Record<string, unknown> | null {
	const configPath = resolveProjectConfigPath(args);
	if (!configPath) return null;

	try {
		return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`Failed to parse the config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * 合并配置文件与命令行的 ignore 规则。
 *
 * 旧实现在 scanner 和两个 driver 里各读一遍配置文件，driver 甚至是在依赖循环体内
 * 逐个依赖重复读盘；这里统一成一次读取。
 */
export function resolveIgnoreRules(args: IgnoreArgs): IgnoreRules {
	const config = readProjectConfig(args) || {};

	return {
		paths: [...readStringArray(config, "ignorePath"), ...splitCliValue(args.ignorePath)],
		files: [...readStringArray(config, "ignoreFile"), ...splitCliValue(args.ignoreFile)],
		dependencies: [...readStringArray(config, "ignoreDep"), ...splitCliValue(args.ignoreDep)],
	};
}
