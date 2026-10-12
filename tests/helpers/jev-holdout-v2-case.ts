import type { JevCase } from "./jev-review-case";

// Freeze before any API call; do not tune production on this set's results.
// Ground truth is the supplied local code relationship, not deployed execution.
export const JEV_HOLDOUT_V2_CASES: JevCase[] = [
	{ id: "n01", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const choices = { primary: "tooling-lib", fallback: "other-lib" }; require(choices.primary);' },
	{ id: "n02", category: "runtime", fileRole: "source", language: "zh", expected: "confirmed-used", code: 'const name = ["tooling", "lib"].join("-"); import(name); // 引入即算使用，不要求后续调用' },
	{ id: "n03", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const load = () => require("tooling-lib"); export const library = load();' },
	{ id: "n04", category: "runtime", fileRole: "source", language: "zh", expected: "confirmed-used", code: 'const entry = "tooling-lib"; const library = require(entry); export { library };' },
	{ id: "n05", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const catalog = ["other-lib", "tooling-lib"]; const selected = catalog[1]; require(selected).start();' },
	{ id: "n06", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { check: "npm exec -- tooling-lib --verify" } }) },
	{ id: "n07", category: "tooling", fileRole: "script", language: "zh", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { build: "node ./prepare.js && tooling-lib --compile" } }), files: { "prepare.js": 'console.log("准备完成");' } },
	{ id: "n08", category: "tooling", fileRole: "config", language: "en", expected: "likely-tooling-usage", code: 'const id = "tooling-lib"; const plugin = require(id); export default { plugins: [plugin({ enabled: true })] };' },
	{ id: "n09", category: "tooling", fileRole: "config", language: "zh", expected: "likely-tooling-usage", code: 'const registry = { build: "tooling-lib" }; module.exports = { plugins: [require(registry.build)()] };' },
	{ id: "n10", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { lint: "tooling-lib --lint", test: "node test.js" } }), files: { "test.js": 'console.log("test");' } },
	{ id: "n11", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const title = "tooling-lib"; const message = `Previous package: ${title}`; console.log(message);' },
	{ id: "n12", category: "unused", fileRole: "source", language: "zh", expected: "high-confidence-unused", code: 'const options = ["tooling-lib", "other-lib"]; console.log(options.join(",")); // 列表只用于显示' },
	{ id: "n13", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const oldPackage = "tooling-lib"; const activePackage = "other-lib"; require(activePackage).run();' },
	{ id: "n14", category: "unused", fileRole: "source", language: "zh", expected: "high-confidence-unused", code: '// 下一版本可能采用 tooling-lib，尚无当前集成要求。\nexport function format(value: string) { return value.trim(); }', files: { "data.json": '{"description":"tooling-lib migration example"}' } },
	{ id: "n15", category: "unused", fileRole: "script", language: "en", expected: "high-confidence-unused", code: JSON.stringify({ scripts: { show: 'node -e "console.log(\'tooling-lib\')"' } }) },
	{ id: "n16", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const title = "tooling-lib"; export const metadata = { title };' },
	{ id: "n17", category: "ambiguous", fileRole: "config", language: "zh", expected: "needs-review", code: 'const id = "tooling-lib"; export default { plugins: [id] }; // 配置消费入口未提供' },
	{ id: "n18", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const id = "tooling-lib"; externalLoader(id); // externalLoader implementation unavailable' },
	{ id: "n19", category: "ambiguous", fileRole: "source", language: "zh", expected: "needs-review", code: 'const name = process.env.ADAPTER; import(name); // 当前适配器名无法确定，可能加载目标包' },
	{ id: "n20", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'const name = "tooling-lib"; console.log(name);', files: { "loader.ts": 'require(process.env.RUNTIME_ADAPTER);' } },
];
