import { parseAST } from "../../src/analyzer/parser";

describe("parseAST", () => {
	it("parses TypeScript, JSX, and dynamic imports", async () => {
		const asts = await parseAST([
			`
				import React from "react";

				type Props = { label: string };
				const view = <button>{("ok" satisfies Props["label"])}</button>;
				const loaded = import("lazy-lib");
				export { view, loaded };
			`,
		]);
		const ast = asts[0]!;

		expect(ast).toBeDefined();
		expect(ast.program.body.length).toBeGreaterThan(0);
	});

	it("parses current import attributes syntax", async () => {
		const asts = await parseAST([
			`import data from "./data.json" with { type: "json" }; export default data;`,
		]);
		const ast = asts[0]!;

		expect(ast.program.body[0]!.type).toBe("ImportDeclaration");
	});

	it("falls back for deprecated import assert syntax", async () => {
		const asts = await parseAST([
			`import data from "./data.json" assert { type: "json" }; export default data;`,
		]);
		const ast = asts[0]!;

		expect(ast.program.body[0]!.type).toBe("ImportDeclaration");
	});

	it("throws a useful error for invalid source", async () => {
		await expect(parseAST(["const broken = ;"])).rejects.toThrow(
			/Failed to parse file at index 0/
		);
	});
});
