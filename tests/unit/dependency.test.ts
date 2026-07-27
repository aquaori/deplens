import { buildAnalysisSummary, classifyUnusedDependency } from "../../src/analyzer/dependency";
import { collectReferences } from "../../src/analyzer/references";
import { createExternalSpecifierFilter } from "../../src/analyzer/specifier";
import { DeclaredDependency, LockfileGraph, ManifestSection } from "../../src/types";
import { parseCode } from "../helpers/sources";

function declared(
	name: string,
	options: {
		section?: ManifestSection;
		range?: string;
		requiredBy?: DeclaredDependency["requiredBy"];
	} = {}
): DeclaredDependency {
	return {
		name,
		section: options.section || "dependencies",
		range: options.range || "1.0.0",
		requiredBy: options.requiredBy || [],
	};
}

function graph(declaredList: DeclaredDependency[]): LockfileGraph {
	return {
		manager: "npm",
		lockfilePath: "/virtual/package-lock.json",
		importerKey: ".",
		declared: declaredList,
		transitiveEdgeCount: 42,
	};
}

function referencesFor(code: string) {
	return collectReferences({
		packageName: "fixture",
		blocks: parseCode(code),
		filter: createExternalSpecifierFilter("/virtual"),
	});
}

describe("collectReferences", () => {
	it("marks import, require, subpath, and re-export references", () => {
		const { references } = referencesFor(`
			import lodash from "lodash";
			const debug = require("debug/src/browser");
			const pkg = import("@scope/pkg/sub/path");
			export { helper } from "helper-lib";
			export * from "star-lib";
			export { lodash, debug, pkg };
		`);
		const names = references.map((item) => item.dependencyName);

		expect(names).toContain("lodash");
		expect(names).toContain("debug");
		expect(names).toContain("@scope/pkg");
		expect(names).toContain("helper-lib");
		expect(names).toContain("star-lib");
		expect(names).not.toContain("left-pad");
	});

	it("ignores node built-ins and project path aliases", () => {
		const { references } = referencesFor(`
			import fs from "fs";
			import path from "node:path";
			import Foo from "@/components/Foo";
			import Bar from "~/utils/bar";
			import lodash from "lodash";
		`);

		expect(references.map((item) => item.dependencyName)).toEqual(["lodash"]);
	});

	it("flags type-only imports separately instead of dropping them", () => {
		const { references } = referencesFor(`import type { Schema } from "zod"; export type X = Schema;`);

		expect(references).toHaveLength(1);
		expect(references[0]).toMatchObject({ dependencyName: "zod", isTypeOnly: true });
	});

	it("records non-literal require and import calls as dynamic specifiers", () => {
		const { references, dynamicSpecifiers } = referencesFor(
			`const name = "runtime-only"; require(name); import(name);`
		);

		expect(references).toHaveLength(0);
		expect(dynamicSpecifiers.map((item) => item.kind).sort()).toEqual(["import", "require"]);
		expect(dynamicSpecifiers[0]!.expression).not.toBe("");
	});

	it("does not crash on a zero-argument require call", () => {
		expect(() => referencesFor(`module.exports = require();`)).not.toThrow();
	});
});

describe("classifyUnusedDependency", () => {
	it("treats a dependency nothing else depends on as a real orphan", () => {
		expect(classifyUnusedDependency(declared("left-pad"))).toBe("unused-orphan");
	});

	it("treats a dependency other installed packages require as a redundant declaration", () => {
		const dependency = declared("ms", {
			range: "2.1.2",
			requiredBy: [{ package: "debug", section: "dependencies", range: "2.1.2" }],
		});

		expect(classifyUnusedDependency(dependency)).toBe("unused-still-installed");
	});

	it("keeps a dependency that an installed package requires as a peer dependency", () => {
		const dependency = declared("react", {
			range: "18.2.0",
			requiredBy: [{ package: "react-dom", section: "peerDependencies", range: "^18.0.0" }],
		});

		expect(classifyUnusedDependency(dependency)).toBe("keep-peer-requirement");
	});

	it("flags a declaration whose range no requirer accepts as a version pin", () => {
		const dependency = declared("semver", {
			range: "7.6.0",
			requiredBy: [{ package: "some-tool", section: "dependencies", range: "^6.0.0" }],
		});

		expect(classifyUnusedDependency(dependency)).toBe("unused-version-pin");
	});
});

describe("buildAnalysisSummary", () => {
	it("keeps transitively required declarations in the report instead of hiding them", () => {
		const summary = buildAnalysisSummary({
			graph: graph([
				declared("used-lib"),
				declared("left-pad"),
				declared("ms", {
					requiredBy: [{ package: "debug", section: "dependencies", range: "1.0.0" }],
				}),
			]),
			references: referencesFor(`import used from "used-lib"; export { used };`).references,
			dynamicSpecifiers: [],
			ignoredDependencies: [],
		});

		expect(summary.unusedDependencies.map((item) => item.name).sort()).toEqual(["left-pad", "ms"]);
		expect(summary.unusedDependencies.find((item) => item.name === "ms")?.unusedClass).toBe(
			"unused-still-installed"
		);
		expect(summary.usedDependencies).toBe(1);
	});

	it("reports declared dependency count, not lockfile edge count", () => {
		const summary = buildAnalysisSummary({
			graph: graph([declared("a"), declared("b")]),
			references: [],
			dynamicSpecifiers: [],
			ignoredDependencies: [],
		});

		expect(summary.totalDependencies).toBe(2);
		expect(summary.transitiveEdgeCount).toBe(42);
	});

	it("separates unused dev dependencies from unused runtime dependencies", () => {
		const summary = buildAnalysisSummary({
			graph: graph([
				declared("unused-lib"),
				declared("typescript", { section: "devDependencies" }),
				declared("used-dev-lib", { section: "devDependencies" }),
			]),
			references: referencesFor(`import x from "used-dev-lib"; export { x };`).references,
			dynamicSpecifiers: [],
			ignoredDependencies: [],
		});

		expect(summary.unusedDependencies.map((item) => item.name)).toEqual(["unused-lib"]);
		expect(summary.devDependencies.map((item) => item.name)).toEqual(["typescript"]);
	});

	it("surfaces runtime dependencies that are only referenced from type positions", () => {
		const summary = buildAnalysisSummary({
			graph: graph([declared("zod")]),
			references: referencesFor(`import type { Schema } from "zod"; export type X = Schema;`).references,
			dynamicSpecifiers: [],
			ignoredDependencies: [],
		});

		expect(summary.unusedDependencies).toEqual([]);
		expect(summary.typeOnlyDependencies.map((item) => item.name)).toEqual(["zod"]);
	});

	it("honours ignored dependencies", () => {
		const summary = buildAnalysisSummary({
			graph: graph([declared("nodemon"), declared("left-pad")]),
			references: [],
			dynamicSpecifiers: [],
			ignoredDependencies: ["nodemon"],
		});

		expect(summary.unusedDependencies.map((item) => item.name)).toEqual(["left-pad"]);
	});
});
