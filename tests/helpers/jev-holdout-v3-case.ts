import type { JevCase } from "./jev-review-case";

// New labels frozen before live calls. Never tune on this set during this round.
export const JEV_HOLDOUT_V3_CASES: JevCase[] = [
	{ id: "p01", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const prefix = "tooling"; const name = prefix + "-lib"; const alias = name; require(alias);' },
	{ id: "p02", category: "runtime", fileRole: "source", language: "zh", expected: "confirmed-used", code: 'const name = ["tool", "ing", "-lib"].join(""); import(name);' },
	{ id: "p03", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const name = "tooling-lib"; const entry = name + "/adapter"; module.exports = require(entry);' },
	{ id: "p04", category: "runtime", fileRole: "source", language: "zh", expected: "confirmed-used", code: 'import library from "tooling-lib"; // 引入即算使用，即使绑定未使用\nexport const ready = true;' },
	{ id: "p05", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const id = "tooling-lib"; const service = require(id); export default service;' },
	{ id: "p06", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { prepare: 'node --eval "const name = \'tooling-lib\'; require(name).prepare()"' } }) },
	{ id: "p07", category: "tooling", fileRole: "script", language: "zh", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { build: "pnpm exec tooling-lib --bundle" } }) },
	{ id: "p08", category: "tooling", fileRole: "config", language: "en", expected: "likely-tooling-usage", code: 'const base = "tooling"; const plugin = require(base + "-lib"); export default { plugins: [plugin()] };' },
	{ id: "p09", category: "tooling", fileRole: "script", language: "zh", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { verify: "echo tooling-lib && tooling-lib --verify" } }) },
	{ id: "p10", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { run: 'node -e "import(\'tooling-lib\').then(mod => mod.run())"' } }) },
	{ id: "p11", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const retired = "tooling-lib"; const first = "other-lib"; const actual = first; require(actual).run(); console.log(retired);' },
	{ id: "p12", category: "unused", fileRole: "source", language: "zh", expected: "high-confidence-unused", code: 'const label = "tooling-lib"; import service from "other-lib"; service.run(); console.log(label);' },
	{ id: "p13", category: "unused", fileRole: "script", language: "en", expected: "high-confidence-unused", code: JSON.stringify({ scripts: { show: 'node --eval "console.warn(\'tooling-lib\')"' } }) },
	{ id: "p14", category: "unused", fileRole: "script", language: "zh", expected: "high-confidence-unused", code: JSON.stringify({ scripts: { show: "node -e 'const title = \"tooling-lib\"; console.log(title)'" } }) },
	{ id: "p15", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const oldName = "tooling-lib"; const current = ["other", "lib"].join("-"); require(current); console.log(oldName);' },
	{ id: "p16", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const oldName = "tooling-lib"; const current = "other-lib"; require(current); export { oldName };' },
	{ id: "p17", category: "ambiguous", fileRole: "script", language: "zh", expected: "needs-review", code: JSON.stringify({ scripts: { run: 'node --eval "import(process.env.PLUGIN)"' } }) },
	{ id: "p18", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const title = "tooling-lib"; const actual = "other-lib"; require(actual); externalRegistry(title); // externalRegistry implementation unavailable' },
	{ id: "p19", category: "ambiguous", fileRole: "source", language: "zh", expected: "needs-review", code: 'let selected = "other-lib"; selected = process.env.PLUGIN; require(selected); // 无法确定当前值' },
	{ id: "p20", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const title = "tooling-lib"; console.log(title);', files: { "adapter.ts": 'const selected = JSON.parse(process.env.PLUGINS || "[]")[0]; require(selected);' } },
];
