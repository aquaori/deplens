import type { JevCase } from "./jev-review-case";

// Labels frozen before the first holdout call. Never tune prompts on this set.
export const JEV_HOLDOUT_CASES: JevCase[] = [
	{ id: "h01", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const target = "tooling-lib"; module.exports = require(target);' },
	{ id: "h02", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const target = "tooling-lib"; import(target).then(({ default: create }) => create());' },
	{ id: "h03", category: "runtime", fileRole: "source", language: "zh", expected: "confirmed-used", code: 'const prefix = "tooling"; const target = prefix + "-lib"; // 使用当前实现\nrequire(target).run();' },
	{ id: "h04", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { compile: "tooling-lib --build && node -e \"console.log(1)\"" } }) },
	{ id: "h05", category: "tooling", fileRole: "config", language: "zh", expected: "likely-tooling-usage", code: 'export default { plugins: ["tooling-lib"] };' },
	{ id: "h06", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { verify: "npx tooling-lib --check" } }) },
	{ id: "h07", category: "unused", fileRole: "source", language: "zh", expected: "high-confidence-unused", code: '// 旧版 tooling-lib 已被内部函数替换。\nexport function sum(a: number, b: number) { return a + b; }' },
	{ id: "h08", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: '// import "tooling-lib";\nexport const enabled = false;' },
	{ id: "h09", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const example = "tooling-lib"; console.log("example only");' },
	{ id: "h10", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'export const integrations = ["tooling-lib"]; // consumer implementation unavailable' },
	{ id: "h11", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const selected = process.env.PLUGIN; require(selected);' },
	{ id: "h12", category: "ambiguous", fileRole: "source", language: "zh", expected: "needs-review", code: '// 当前部署必须使用 tooling-lib，但部署入口未提供，无法核实。\nexport const ready = true;' },
];
