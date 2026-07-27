import { Result } from "../../src/types";

/**
 * 构造一个满足 Result 完整形状的测试汇总对象。
 * 测试只需要覆盖自己关心的字段，其余走默认值，避免每个测试都手抄一遍 schema。
 */
export function createResult(overrides: Partial<Result> = {}): Result {
	return {
		usedDependencies: 0,
		unusedDependencies: [],
		unusedDependenciesCount: 0,
		ununsedDependenciesCount: 0,
		totalDependencies: 0,
		transitiveEdgeCount: 0,
		devDependencies: [],
		typeOnlyDependencies: [],
		dynamicImports: [],
		lockfile: { resolved: true, manager: "npm", path: "/virtual/package-lock.json" },
		...overrides,
	};
}
