import { parseAST } from "../../src/analyzer/parser";
import { parseDependencies, summaryData } from "../../src/analyzer/dependency";
import { Dependency } from "../../src/types";

function dependency(name: string, isDev = false): Dependency {
	return {
		name,
		type: "",
		version: {},
		usage: false,
		isDev,
	};
}

describe("dependency analysis", () => {
	it("marks import, require, and subpath references as used", async () => {
		const systemDeps = [
			dependency("lodash"),
			dependency("debug"),
			dependency("@scope/pkg"),
			dependency("left-pad"),
		];
		const asts = await parseAST([
			`
				import lodash from "lodash";
				const debug = require("debug/src/browser");
				const pkg = import("@scope/pkg/sub/path");
				export { lodash, debug, pkg };
			`,
		]);

		await parseDependencies(asts, systemDeps);

		expect(systemDeps.find((item) => item.name === "lodash")).toMatchObject({
			usage: true,
			type: "import",
		});
		expect(systemDeps.find((item) => item.name === "debug")).toMatchObject({
			usage: true,
			type: "require",
		});
		expect(systemDeps.find((item) => item.name === "@scope/pkg")).toMatchObject({
			usage: true,
			type: "import",
		});
		expect(systemDeps.find((item) => item.name === "left-pad")).toMatchObject({
			usage: false,
		});
	});

	it("records non-literal require calls as dynamic dependencies", async () => {
		const systemDeps: Dependency[] = [];
		const asts = await parseAST([`const name = "runtime-only"; require(name);`]);

		await parseDependencies(asts, systemDeps);

		expect(systemDeps).toContainEqual(
			expect.objectContaining({
				type: "dynamic",
				usage: false,
			})
		);
	});

	it("does not count dev dependencies as production unused dependencies", () => {
		const summary = summaryData([
			{
				name: "used-lib",
				type: "import",
				version: {},
				usage: true,
				isDev: false,
			},
			{
				name: "unused-lib",
				type: "",
				version: {},
				usage: false,
				isDev: false,
			},
			{
				name: "typescript",
				type: "",
				version: {},
				usage: false,
				isDev: true,
			},
		], 3);

		expect(summary.unusedDependencies.map((item) => item.name)).toEqual(["unused-lib"]);
		expect(summary.devDependencies.map((item) => item.name)).toEqual(["typescript"]);
	});
});
