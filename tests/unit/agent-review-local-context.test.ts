import { getLocalQuestionContext } from "../../src/agent/review-local-context";
import type { ReviewEvidenceRecord } from "../../src/types";

function context(content: string, filePath = "source.ts") {
	const record: ReviewEvidenceRecord = { id: `coverage:${filePath}`, kind: "fact", sourceType: "context", filePath, summary: "Complete source", content };
	return getLocalQuestionContext(record, "tooling-lib");
}

describe("Jev supplemental local syntax", () => {
	it("resolves immutable aliases and literal construction without invoking source functions", () => {
		const result = context('const prefix = "tooling"; const name = prefix + "-lib"; const alias = name; require(alias); import(["tooling", "lib"].join("-"));');
		expect(result.loadRelations?.map((load) => load.specifier)).toEqual(["tooling-lib", "tooling-lib"]);
		expect(result.loadRelations?.map((load) => load.expression)).toEqual(["require(alias)", 'import(["tooling", "lib"].join("-"))']);
		expect(result.stringConsumer).toBe(false);
	});
	it("distinguishes a target string from loading another package", () => {
		const result = context('const oldName = "tooling-lib"; const actual = "other-lib"; require(actual); export { oldName };');
		expect(result.loadRelations?.[0]?.specifier).toBe("other-lib");
		// This selects a consumer question, not an unused verdict: exports remain
		// in the full record and must be examined by Jev.
		expect(result.stringConsumer).toBe(true);
	});
	it("retains actual references and exports rather than closing consumers from other loads", () => {
		const result = context('const unused = "tooling-lib"; const exported = "tooling-lib"; const other = "other-lib"; require(other); export { exported };');
		expect(result.targetBindings?.find((binding) => binding.name === "unused")?.referenceCount).toBe(0);
		expect(result.targetBindings?.find((binding) => binding.name === "exported")?.references).toContain("export { exported };");
		const directExport = context('export const name = "tooling-lib"; const other = "other-lib"; require(other);');
		expect(directExport.targetBindings?.[0]?.declaration).toContain('export const name = "tooling-lib"');
	});
	it.each([
		'let name = "other-lib"; name = process.env.PLUGIN; require(name);',
		'const names = ["other-lib"]; names[0] = "tooling-lib"; require(names[0]);',
		'const names = ["other-lib"]; names.push("tooling-lib"); require(names[1]);',
		'const name = choosePlugin(); require(name);',
		'require(name); const name = "other-lib";',
		'const name = "other-lib"; { const name = process.env.PLUGIN; require(name); }',
		'const name = "other-lib"; eval(process.env.CODE); require(name);',
	])("does not invent resolved names for mutable, shadowed, unknown or dynamic code: %s", (code) => {
		expect(context(code).loadRelations).toBeUndefined();
	});
	it("does not execute arbitrary functions while building hints", () => {
		const spy = jest.fn();
		(globalThis as any).__deplensProbe = spy;
		try { expect(context('const name = globalThis.__deplensProbe(); require(name);').loadRelations).toBeUndefined(); expect(spy).not.toHaveBeenCalled(); }
		finally { delete (globalThis as any).__deplensProbe; }
	});
	it("keeps comments separate from executable names", () => {
		expect(context('// tooling-lib is obsolete\nexport const active = true;').stringConsumer).toBe(false);
	});
	it("preserves unknown consumers alongside a resolved call", () => {
		const result = context('const name = "other-lib"; require(name); require(process.env.PLUGIN);');
		expect(result.loadRelations?.map((load) => load.specifier)).toEqual(["other-lib", null]);
		expect(result.stringConsumer).toBe(false);
	});
	it("extracts whole quoted Node eval scripts and retains incomplete shell forms", () => {
		const result = context(JSON.stringify({ scripts: { text: 'node -e "console.log(\'tooling-lib\')"', load: 'node --eval "const name = \'tooling-lib\'; require(name)"', chained: 'node -e "console.log(1)" && tooling-lib', expansion: 'node -e "require(\'$PLUGIN\')"' } }), "package.json");
		expect(result.inlineScripts?.[0]).toMatchObject({ status: "parsed", code: "console.log('tooling-lib')" });
		expect(result.inlineScripts?.[1]?.loadRelations?.[0]?.specifier).toBe("tooling-lib");
		expect(result.inlineScripts?.slice(2).map((item) => item.status)).toEqual(["unparsed", "unparsed"]);
	});
});
