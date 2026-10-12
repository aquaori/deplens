import type { JevCase } from "./jev-review-case";

// Development pairs for the v6 consumer-boundary failures. Not a holdout.
export const JEV_CONSUMER_CASES: JevCase[] = [
	{ id: "d01", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const example = "tooling-lib"; console.log("example only");' },
	{ id: "d02", category: "unused", fileRole: "source", language: "zh", expected: "high-confidence-unused", code: 'const label = "tooling-lib"; console.log(label); // 只输出名称，不加载模块' },
	{ id: "d03", category: "unused", fileRole: "source", language: "en", expected: "high-confidence-unused", code: 'const details = { title: "tooling-lib" }; console.log(details.title);' },
	{ id: "d04", category: "ambiguous", fileRole: "source", language: "en", expected: "needs-review", code: 'export const example = "tooling-lib";' },
	{ id: "d05", category: "ambiguous", fileRole: "config", language: "en", expected: "needs-review", code: 'export default { plugins: ["tooling-lib"] };' },
	{ id: "d06", category: "ambiguous", fileRole: "source", language: "zh", expected: "needs-review", code: 'const name = "tooling-lib"; globalThis.registerPlugin(name); // 注册器实现未提供' },
	{ id: "d07", category: "tooling", fileRole: "config", language: "en", expected: "likely-tooling-usage", code: 'const name = "tooling-lib"; module.exports = { plugins: [require(name)()] };' },
	{ id: "d08", category: "tooling", fileRole: "config", language: "zh", expected: "likely-tooling-usage", code: 'const plugins = ["tooling-lib"]; export default { plugins: plugins.map(name => require(name)()) };' },
	{ id: "d09", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'const label = "tooling-lib"; require(label);' },
	{ id: "d10", category: "runtime", fileRole: "source", language: "zh", expected: "confirmed-used", code: 'const details = { title: "tooling-lib" }; module.exports = require(details.title);' },
];
