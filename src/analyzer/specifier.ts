import fs from "fs";
import path from "path";
import { builtinModules } from "module";

const MAX_TSCONFIG_EXTENDS_DEPTH = 5;

/**
 * 把子路径导入收敛到包名：`lodash/fp` -> `lodash`，`@scope/pkg/sub` -> `@scope/pkg`。
 */
export function normalizePackageSpecifier(specifier: string): string {
	if (specifier.startsWith("@")) {
		const parts = specifier.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
	}
	return specifier.split("/")[0] || specifier;
}

export function isBuiltInModule(specifier: string): boolean {
	const normalized = specifier.startsWith("node:")
		? specifier.slice("node:".length)
		: specifier;
	return builtinModules.includes(normalized);
}

function isValidNameSegment(segment: string): boolean {
	if (segment === "" || segment.length > 214) return false;
	if (segment.startsWith(".") || segment.startsWith("_") || segment.startsWith("~")) return false;
	if (segment !== segment.toLowerCase()) return false;
	// 必须含有至少一个字母或数字，排除 `~`、`--` 这类纯符号的别名前缀。
	if (!/[a-z0-9]/.test(segment)) return false;
	return /^[a-z0-9\-._~]+$/.test(segment);
}

/**
 * 判断归一化后的名字是否是一个合法的 npm 包名。
 * 用于把 `@/components`、`~/utils` 这类别名从「幽灵依赖」里剔除出去。
 */
export function isValidPackageName(name: string): boolean {
	if (name.startsWith("@")) {
		const parts = name.slice(1).split("/");
		if (parts.length !== 2) return false;
		return isValidNameSegment(parts[0] as string) && isValidNameSegment(parts[1] as string);
	}
	return isValidNameSegment(name);
}

/**
 * 容忍注释与尾逗号的 JSON 解析，tsconfig.json 常带注释。
 */
function parseJsonWithComments(raw: string): Record<string, any> | null {
	const withoutComments = raw
		.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, comment) =>
			comment ? " " : match
		)
		.replace(/,(\s*[}\]])/g, "$1");

	try {
		return JSON.parse(withoutComments) as Record<string, any>;
	} catch {
		return null;
	}
}

function readTsConfigPaths(configPath: string, depth: number): string[] {
	if (depth > MAX_TSCONFIG_EXTENDS_DEPTH || !fs.existsSync(configPath)) {
		return [];
	}

	let raw: string;
	try {
		raw = fs.readFileSync(configPath, "utf-8");
	} catch {
		return [];
	}

	const parsed = parseJsonWithComments(raw);
	if (!parsed) return [];

	const patterns: string[] = [];
	const paths = parsed["compilerOptions"]?.paths;
	if (paths && typeof paths === "object") {
		patterns.push(...Object.keys(paths));
	}

	// 只跟随相对路径的 extends；包名形式的 extends 需要模块解析，收益不足以引入。
	const extendsValue = parsed["extends"];
	if (typeof extendsValue === "string" && extendsValue.startsWith(".")) {
		const nextPath = path.resolve(path.dirname(configPath), extendsValue);
		const resolved = nextPath.endsWith(".json") ? nextPath : `${nextPath}.json`;
		patterns.push(...readTsConfigPaths(resolved, depth + 1));
	}

	return patterns;
}

function patternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

/**
 * 收集项目的路径别名匹配器（tsconfig / jsconfig 的 compilerOptions.paths）。
 * 命中这些模式的 specifier 是项目内部别名，不应被当作未声明的外部依赖。
 */
export function loadPathAliasMatchers(projectPath: string): RegExp[] {
	const patterns = new Set<string>();

	for (const fileName of ["tsconfig.json", "jsconfig.json"]) {
		for (const pattern of readTsConfigPaths(path.join(projectPath, fileName), 0)) {
			patterns.add(pattern);
		}
	}

	return Array.from(patterns).map(patternToRegExp);
}

export interface ExternalSpecifierFilter {
	/** 该 specifier 是否指向一个真实的外部 npm 包。 */
	isExternalPackage(specifier: string): boolean;
}

/**
 * 构建「这是不是一个真实外部包」的判定器。
 * 依次排除：相对路径、绝对路径、Node 内置模块、Node subpath imports(#)、
 * 项目配置的路径别名、以及不符合 npm 命名规则的 specifier。
 */
export function createExternalSpecifierFilter(projectPath: string): ExternalSpecifierFilter {
	const aliasMatchers = loadPathAliasMatchers(projectPath);

	return {
		isExternalPackage(specifier: string): boolean {
			if (typeof specifier !== "string" || specifier.trim() === "") return false;
			if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return false;
			if (/^[a-zA-Z]:[\\/]/.test(specifier)) return false;
			if (specifier.includes("\\")) return false;
			if (isBuiltInModule(specifier)) return false;
			if (aliasMatchers.some((matcher) => matcher.test(specifier))) return false;
			return isValidPackageName(normalizePackageSpecifier(specifier));
		},
	};
}
