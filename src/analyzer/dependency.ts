import {
	DeclaredDependency,
	Dependency,
	DynamicSpecifierRecord,
	LockfileGraph,
	ReferenceEvidence,
	Result,
	UnusedDependencyClass,
} from "../types";
import { rangeAccepts, toComparableVersion } from "../driver/lockfile-graph";

export interface BuildSummaryInput {
	graph: LockfileGraph;
	references: ReferenceEvidence[];
	dynamicSpecifiers: DynamicSpecifierRecord[];
	ignoredDependencies: string[];
	/** package.json scripts 中以命令形式出现的依赖，例如 `"lint": "eslint ."`。 */
	scriptReferenced?: string[];
}

interface UsageInfo {
	used: boolean;
	typeOnly: boolean;
}

/**
 * `@types/foo` -> `foo`，`@types/scope__pkg` -> `@scope/pkg`。
 */
export function resolveTypesCompanion(name: string): string | null {
	if (!name.startsWith("@types/")) return null;
	const target = name.slice("@types/".length);
	if (target === "") return null;
	return target.includes("__") ? `@${target.replace("__", "/")}` : target;
}

/**
 * 类型声明包不会被源码按名字 import，由 TypeScript 隐式消费，
 * 因此不能只凭「没有 import 语句」就判为未使用。
 */
function isImplicitlyUsedTypesPackage(name: string, declaredNames: Set<string>, used: Set<string>): boolean {
	const companion = resolveTypesCompanion(name);
	if (companion === null) return false;
	// @types/node 描述的是 Node 内置模块，没有对应的 npm 包。
	if (companion === "node") return true;
	return used.has(companion) || declaredNames.has(companion);
}

/** 从 scripts 命令串里提取被当作命令调用的依赖名。 */
export function collectScriptReferencedDependencies(
	manifest: Record<string, any>,
	candidates: string[]
): string[] {
	const scripts = manifest?.["scripts"];
	if (!scripts || typeof scripts !== "object") return [];

	const commands = Object.values(scripts).filter((value): value is string => typeof value === "string");
	if (commands.length === 0) return [];

	const referenced = new Set<string>();
	for (const name of candidates) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const patterns = [
			// 作为命令直接调用：`eslint .`
			new RegExp(`(^|[^a-zA-Z0-9@._/-])${escaped}(?=$|[^a-zA-Z0-9@._/-])`),
			// 以路径形式调用：`node ./node_modules/jest/bin/jest.js`
			new RegExp(`node_modules/${escaped}(?=[/'"\\s]|$)`),
		];
		if (commands.some((command) => patterns.some((pattern) => pattern.test(command)))) {
			referenced.add(name);
		}
	}

	return Array.from(referenced);
}

function buildUsageIndex(references: ReferenceEvidence[]): Map<string, UsageInfo> {
	const usage = new Map<string, UsageInfo>();

	for (const reference of references) {
		const current = usage.get(reference.dependencyName);
		if (!current) {
			usage.set(reference.dependencyName, { used: true, typeOnly: reference.isTypeOnly });
			continue;
		}
		// 只要存在一处值引用，就不再算作纯类型使用。
		current.typeOnly = current.typeOnly && reference.isTypeOnly;
	}

	return usage;
}

/**
 * 对「未被源码引用」的依赖判定移除风险。
 *
 * 核心前提：deplens 能建议的只是「从 package.json 删掉这一行」，而不是卸载这个包。
 * 只要还有别的已安装包依赖它，删掉声明后包管理器仍会把它作为传递依赖装上，
 * 因此这种情况反而是零风险的，而不是「不能删」。
 *
 * 唯一真正必须保留声明的是 peerDependencies：依赖方要求由宿主项目提供它。
 */
export function classifyUnusedDependency(declared: DeclaredDependency): UnusedDependencyClass {
	if (declared.requiredBy.some((item) => item.section === "peerDependencies")) {
		return "keep-peer-requirement";
	}

	const installRequirers = declared.requiredBy.filter((item) => item.section !== "peerDependencies");
	if (installRequirers.length === 0) {
		return "unused-orphan";
	}

	const declaredVersion = toComparableVersion(declared.range);
	if (declaredVersion) {
		// 声明的版本连依赖方的范围都不满足，说明这条声明多半是在强行统一/钉住版本，
		// 移除它会改变依赖树的版本收敛结果，需要人工确认。
		const conflicting = installRequirers.some(
			(item) => rangeAccepts(item.range, declaredVersion) === false
		);
		if (conflicting) {
			return "unused-version-pin";
		}
	}

	return "unused-still-installed";
}

export const UNUSED_CLASS_ORDER: UnusedDependencyClass[] = [
	"unused-orphan",
	"unused-version-pin",
	"unused-still-installed",
	"keep-peer-requirement",
];

export function isRemovalRecommended(unusedClass: UnusedDependencyClass): boolean {
	return unusedClass === "unused-orphan" || unusedClass === "unused-still-installed";
}

function toDependencyRecord(
	declared: DeclaredDependency,
	usage: UsageInfo | undefined,
	usageKind: Dependency["usageKind"]
): Dependency {
	const used = usageKind !== undefined;
	const record: Dependency = {
		name: declared.name,
		type: used ? "import" : "",
		version: declared.range === "" ? [] : [declared.range],
		usage: used,
		isDev: declared.section === "devDependencies",
		section: declared.section,
		requiredBy: declared.requiredBy,
	};

	if (used) {
		record.usageKind = usageKind;
		record.isTypeOnlyUsage = usageKind === "source" && Boolean(usage?.typeOnly);
	} else {
		record.unusedClass = classifyUnusedDependency(declared);
	}

	return record;
}

/**
 * 由 lockfile 关系图 + 源码引用产出分析汇总。
 *
 * 与旧实现的关键差异：所有声明的依赖都会进入判定，
 * 「被其它包依赖」不再是把依赖排除出分析范围的理由，而是移除风险的分级依据。
 */
export function buildAnalysisSummary(input: BuildSummaryInput): Omit<Result, "lockfile"> {
	const ignored = new Set(input.ignoredDependencies);
	const usage = buildUsageIndex(input.references);
	const scriptReferenced = new Set(input.scriptReferenced || []);
	const declaredNames = new Set(input.graph.declared.map((item) => item.name));
	const sourceUsedNames = new Set(
		Array.from(usage.entries()).filter(([, info]) => info.used).map(([name]) => name)
	);

	const resolveUsageKind = (name: string): Dependency["usageKind"] => {
		if (usage.get(name)?.used) return "source";
		if (scriptReferenced.has(name)) return "script";
		if (isImplicitlyUsedTypesPackage(name, declaredNames, sourceUsedNames)) return "types-companion";
		return undefined;
	};

	const records = input.graph.declared
		.filter((declared) => !ignored.has(declared.name))
		.map((declared) =>
			toDependencyRecord(declared, usage.get(declared.name), resolveUsageKind(declared.name))
		);

	const unusedDependencies = records.filter((item) => !item.usage && !item.isDev);
	const unusedDevDependencies = records.filter((item) => !item.usage && item.isDev);
	const typeOnlyDependencies = records.filter(
		(item) => item.usage && item.isTypeOnlyUsage && !item.isDev
	);

	return {
		usedDependencies: records.filter((item) => item.usage).length,
		unusedDependencies,
		unusedDependenciesCount: unusedDependencies.length,
		ununsedDependenciesCount: unusedDependencies.length,
		totalDependencies: records.length,
		transitiveEdgeCount: input.graph.transitiveEdgeCount,
		devDependencies: unusedDevDependencies,
		typeOnlyDependencies,
		dynamicImports: input.dynamicSpecifiers,
	};
}
