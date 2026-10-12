import type { JevCase } from "./jev-review-case";
import { JEV_CASES } from "./jev-review-case";
import { JEV_HOLDOUT_V2_CASES } from "./jev-holdout-v2-case";

// The previous holdout is now known development material; labels stay unchanged.
export const JEV_RELATION_CASES: JevCase[] = [
	...JEV_HOLDOUT_V2_CASES.filter((item) => ["n02", "n13", "n15", "n16", "n18", "n19", "n20"].includes(item.id)),
	JEV_CASES.find((item) => item.id === "runtime-4")!,
	{ id: "r01", category: "tooling", fileRole: "script", language: "en", expected: "likely-tooling-usage", code: JSON.stringify({ scripts: { run: 'node -e "require(\'tooling-lib\').run()"' } }) },
	{ id: "r02", category: "ambiguous", fileRole: "script", language: "zh", expected: "needs-review", code: JSON.stringify({ scripts: { run: 'node -e "require(process.env.PLUGIN)"' } }) },
	{ id: "r03", category: "runtime", fileRole: "source", language: "en", expected: "confirmed-used", code: 'let name = "other-lib"; name = "tooling-lib"; require(name);' },
	{ id: "r04", category: "unused", fileRole: "source", language: "zh", expected: "high-confidence-unused", code: 'const unused = "tooling-lib"; const first = "other-lib"; const selected = first; require(selected); console.log(unused);' },
];
