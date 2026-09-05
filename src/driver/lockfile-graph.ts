import fs from "fs";
import yaml from "js-yaml";
import { satisfies } from "compare-versions";
import {
	DeclaredDependency,
	LockfileGraph,
	ManifestSection,
	TransitiveRequirement,
} from "../types";
import { PackageManagerResolution, resolvePackageManager } from "./package-manager";

const REQUIRER_SECTIONS: ManifestSection[] = [
	"dependencies",
	"peerDependencies",
	"optionalDependencies",
];

const DECLARED_SECTIONS: ManifestSection[] = [
	"dependencies",
	"peerDependencies",
	"optionalDependencies",
	"devDependencies",
];

const lockfileDocumentCache = new Map<string, { mtimeMs: number; value: Record<string, any> }>();

/**
 * 去掉 pnpm 版本串里的 peer 后缀，例如 `4.3.4(supports-color@8.1.1)` -> `4.3.4`。
 */
function stripPeerSuffix(version: string): string {
	return version.replace(/\(.+?\)+/g, "");
}

/**
 * 把一个 npm 语义化范围收敛成可用于 `satisfies` 的裸版本号。
 * 无法收敛时返回 null，调用方据此跳过版本比较而不是给出错误结论。
 */
export function toComparableVersion(range: string): string | null {
	const cleaned = stripPeerSuffix(range).trim();
	const match = cleaned.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?/);
	return match ? match[0] : null;
}

/**
 * 判断某个版本是否被一个范围接受。范围语法超出 compare-versions 能力时返回 null（未知），
 * 由调用方决定如何处理未知，避免把「无法判断」当成「不满足」。
 */
export function rangeAccepts(range: string, version: string): boolean | null {
	const cleanedRange = stripPeerSuffix(range).trim();
	if (cleanedRange === "" || cleanedRange === "*" || cleanedRange === "latest") {
		return true;
	}
	if (cleanedRange.startsWith("workspace:") || cleanedRange.startsWith("link:") || cleanedRange.startsWith("file:")) {
		return true;
	}

	for (const alternative of cleanedRange.split("||")) {
		try {
			if (satisfies(version, alternative.trim())) {
				return true;
			}
		} catch {
			return null;
		}
	}

	return false;
}

function readJsonLockfile(lockfilePath: string): Record<string, any> {
	const stat = fs.statSync(lockfilePath);
	const cached = lockfileDocumentCache.get(lockfilePath);
	if (cached?.mtimeMs === stat.mtimeMs) return cached.value;
	const value = JSON.parse(fs.readFileSync(lockfilePath, "utf-8")) as Record<string, any>;
	lockfileDocumentCache.set(lockfilePath, { mtimeMs: stat.mtimeMs, value });
	return value;
}

function readYamlLockfile(lockfilePath: string): Record<string, any> {
	const stat = fs.statSync(lockfilePath);
	const cached = lockfileDocumentCache.get(lockfilePath);
	if (cached?.mtimeMs === stat.mtimeMs) return cached.value;
	const value = (yaml.load(fs.readFileSync(lockfilePath, "utf-8")) || {}) as Record<string, any>;
	lockfileDocumentCache.set(lockfilePath, { mtimeMs: stat.mtimeMs, value });
	return value;
}

/**
 * 从 npm lockfile 的 packages 键提取包名：`node_modules/a/node_modules/b` -> `b`。
 */
function parseNpmPackageKey(key: string): string | null {
	const marker = "node_modules/";
	const index = key.lastIndexOf(marker);
	if (index < 0) {
		// 不含 node_modules 的键是 workspace importer，不是被安装的包。
		return null;
	}
	const name = key.slice(index + marker.length);
	return name === "" ? null : name;
}

/**
 * 从 pnpm 的 snapshot / package 键提取包名：
 *  - v9: `debug@4.3.4(supports-color@8.1.1)` -> `debug`
 *  - v6: `/debug/4.3.4` 或 `/@scope/name/1.0.0`
 */
function parsePnpmPackageKey(key: string): string | null {
	if (key.startsWith("/")) {
		const segments = key.slice(1).split("/");
		if (segments.length < 2) return null;
		return segments[0]?.startsWith("@")
			? `${segments[0]}/${segments[1]}`
			: (segments[0] ?? null);
	}

	const separatorIndex = key.startsWith("@")
		? key.indexOf("@", 1)
		: key.indexOf("@");
	if (separatorIndex <= 0) {
		return key === "" ? null : key;
	}
	return key.slice(0, separatorIndex);
}

interface RequirerCollection {
	requiredBy: Map<string, TransitiveRequirement[]>;
	transitiveEdgeCount: number;
}

function collectRequirers(
	entries: Array<[string, unknown]>,
	parseKey: (key: string) => string | null,
	skipKey: (key: string, value: any) => boolean
): RequirerCollection {
	const requiredBy = new Map<string, TransitiveRequirement[]>();
	let transitiveEdgeCount = 0;

	for (const [key, value] of entries) {
		if (!value || typeof value !== "object") continue;
		if (skipKey(key, value)) continue;

		const requirerName = parseKey(key);
		if (!requirerName) continue;

		for (const section of REQUIRER_SECTIONS) {
			const bucket = (value as Record<string, unknown>)[section];
			if (!bucket || typeof bucket !== "object") continue;

			for (const [dependencyName, rawRange] of Object.entries(bucket as Record<string, unknown>)) {
				const range = typeof rawRange === "string"
					? stripPeerSuffix(rawRange)
					: typeof (rawRange as { version?: unknown })?.version === "string"
						? stripPeerSuffix((rawRange as { version: string }).version)
						: null;
				if (range === null) continue;

				const list = requiredBy.get(dependencyName) || [];
				list.push({ package: requirerName, section, range });
				requiredBy.set(dependencyName, list);
				transitiveEdgeCount += 1;
			}
		}
	}

	return { requiredBy, transitiveEdgeCount };
}

function collectDeclared(
	importer: Record<string, any>,
	requiredBy: Map<string, TransitiveRequirement[]>
): DeclaredDependency[] {
	const declared: DeclaredDependency[] = [];
	const seen = new Set<string>();

	for (const section of DECLARED_SECTIONS) {
		const bucket = importer[section];
		if (!bucket || typeof bucket !== "object") continue;

		for (const [name, rawRange] of Object.entries(bucket as Record<string, unknown>)) {
			if (seen.has(name)) continue;
			seen.add(name);

			const range = typeof rawRange === "string"
				? rawRange
				: typeof (rawRange as { specifier?: unknown })?.specifier === "string"
					? (rawRange as { specifier: string }).specifier
					: typeof (rawRange as { version?: unknown })?.version === "string"
						? (rawRange as { version: string }).version
					: "";

			declared.push({
				name,
				section,
				range: stripPeerSuffix(range),
				requiredBy: requiredBy.get(name) || [],
			});
		}
	}

	return declared.sort((a, b) => a.name.localeCompare(b.name));
}

function buildNpmGraph(resolution: PackageManagerResolution): LockfileGraph {
	const manifest = readJsonLockfile(resolution.lockfilePath);
	const packages = (manifest["packages"] || {}) as Record<string, unknown>;
	const importerKey = resolution.importerKey === "." ? "" : resolution.importerKey;
	const importer = packages[importerKey];

	if (!importer || typeof importer !== "object") {
		throw new Error(
			`The importer ${resolution.importerKey} was not found in ${resolution.lockfilePath}.`
		);
	}

	const { requiredBy, transitiveEdgeCount } = collectRequirers(
		Object.entries(packages),
		parseNpmPackageKey,
		(key, value) => key === importerKey || value?.link === true
	);

	return {
		manager: "npm",
		lockfilePath: resolution.lockfilePath,
		importerKey: resolution.importerKey,
		declared: collectDeclared(importer as Record<string, any>, requiredBy),
		transitiveEdgeCount,
	};
}

function buildPnpmGraph(resolution: PackageManagerResolution): LockfileGraph {
	const manifest = readYamlLockfile(resolution.lockfilePath);
	const lockVersion = Number(manifest["lockfileVersion"]);
	const isLegacyLayout = Number.isFinite(lockVersion) && lockVersion < 7;

	const importer = isLegacyLayout && !manifest["importers"]
		? manifest
		: manifest["importers"]?.[resolution.importerKey];

	if (!importer || typeof importer !== "object") {
		throw new Error(
			`The importer ${resolution.importerKey} was not found in ${resolution.lockfilePath}.`
		);
	}

	// pnpm v9 将安装关系放在 snapshots，将 peerDependencies 等包元数据放在 packages；
	// 两者必须合并，否则 peer 要求会被误判成普通依赖。
	const packageEntries = (manifest["packages"] || {}) as Record<string, unknown>;
	const snapshotEntries = (manifest["snapshots"] || {}) as Record<string, unknown>;
	const mergedEntries = new Map<string, Record<string, unknown>>();
	for (const [key, value] of Object.entries(packageEntries)) {
		if (value && typeof value === "object") mergedEntries.set(key, { ...(value as Record<string, unknown>) });
	}
	for (const [key, value] of Object.entries(snapshotEntries)) {
		if (!value || typeof value !== "object") continue;
		const current = mergedEntries.get(key) || {};
		const next = value as Record<string, unknown>;
		for (const section of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
			if (next[section] && typeof next[section] === "object") {
				current[section] = { ...(current[section] as Record<string, unknown> || {}), ...(next[section] as Record<string, unknown>) };
			}
		}
		mergedEntries.set(key, current);
	}
	const packageSource = Array.from(mergedEntries.entries());
	const { requiredBy, transitiveEdgeCount } = collectRequirers(
		packageSource,
		parsePnpmPackageKey,
		(key) => key === ""
	);

	return {
		manager: "pnpm",
		lockfilePath: resolution.lockfilePath,
		importerKey: resolution.importerKey,
		declared: collectDeclared(importer as Record<string, any>, requiredBy),
		transitiveEdgeCount,
	};
}

/**
 * 读取项目对应的 lockfile，产出「声明了什么」+「谁依赖了它」的关系图。
 *
 * 这里刻意不做任何「用没用到」的判断：是否未使用由源码引用决定，
 * requiredBy 只用于判断移除声明的风险等级，不再用来把依赖排除出分析范围。
 */
export function buildLockfileGraph(projectPath: string): LockfileGraph {
	const resolution = resolvePackageManager(projectPath);

	if (!fs.existsSync(resolution.lockfilePath)) {
		throw new Error(
			`The ${resolution.lockfilePath} file does not exist, so dependencies cannot be resolved.`
		);
	}

	return resolution.manager === "pnpm"
		? buildPnpmGraph(resolution)
		: buildNpmGraph(resolution);
}
