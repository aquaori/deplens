import { parseSources } from "../../src/analyzer/parser";
import { sourceFile } from "../helpers/sources";

describe("parseSources", () => {
	it("parses TypeScript, JSX, and dynamic imports", () => {
		const { blocks, errors } = parseSources([
			sourceFile(
				"src/view.tsx",
				`
					import React from "react";

					type Props = { label: string };
					const view = <button>{("ok" satisfies Props["label"])}</button>;
					const loaded = import("lazy-lib");
					export { view, loaded };
				`
			),
		]);

		expect(errors).toEqual([]);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.ast.program.body.length).toBeGreaterThan(0);
	});

	it("parses current import attributes syntax", () => {
		const { blocks } = parseSources([
			sourceFile("src/a.ts", `import data from "./data.json" with { type: "json" }; export default data;`),
		]);

		expect(blocks[0]!.ast.program.body[0]!.type).toBe("ImportDeclaration");
	});

	it("falls back for deprecated import assert syntax", () => {
		const { blocks } = parseSources([
			sourceFile("src/a.ts", `import data from "./data.json" assert { type: "json" }; export default data;`),
		]);

		expect(blocks[0]!.ast.program.body[0]!.type).toBe("ImportDeclaration");
	});

	it("keeps file attribution on every parsed block", () => {
		const { blocks } = parseSources([
			sourceFile("packages/app/src/index.ts", `import "lodash";`),
		]);

		expect(blocks[0]!.file.path).toBe("packages/app/src/index.ts");
		expect(blocks[0]!.lineOffset).toBe(0);
	});

	it("attributes parse problems to the offending file instead of failing the whole run", () => {
		const { errors } = parseSources([
			sourceFile("src/ok.ts", `import "lodash";`),
			sourceFile("src/broken.ts", "const broken = ;"),
		]);

		expect(errors.map((item) => item.path)).toEqual(["src/broken.ts"]);
		expect(errors[0]!.message).not.toBe("");
	});
});
