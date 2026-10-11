import fs from "fs";
import path from "path";
import type { SingleProjectAnalysisReport, DependencyReviewCandidate, DependencyReviewDisposition } from "../../src/types";
import { createResult } from "./result";

export interface JevCase {
	id: string;
	category: "tooling" | "runtime" | "unused" | "ambiguous";
	code: string;
	fileRole: "script" | "config" | "source";
	expected: DependencyReviewDisposition;
	language: "en" | "zh";
}

// Labels are fixed before any model run. These are synthetic review replays, not
// a claim about scanner accuracy or coverage of real repositories.
export const JEV_CASES: JevCase[] = [
	...["build", "lint", "test", "format", "dev", "typecheck", "docs", "prepare", "serve", "watch"].map((task, index) => ({
		id: `tooling-${task}`, category: "tooling" as const, fileRole: "script" as const,
		code: JSON.stringify({ scripts: { [task]: `tooling-lib --${task}` } }, null, 2),
		expected: "likely-tooling-usage" as const, language: index % 2 ? "zh" as const : "en" as const,
	})),
	...[
		'const packageName = "tooling-lib"; const service = require(packageName); service.start();',
		'const packageName = "tooling-lib"; import(packageName).then(service => service.start());',
		'const loaders = { service: "tooling-lib" }; require(loaders.service).start();',
		'const providers = ["tooling-lib"]; providers.forEach(name => require(name).register());',
		'const settings = { implementation: "tooling-lib" }; require(settings.implementation).run();',
		'const name = "tooling-lib"; const loaded = require(name); module.exports = loaded;',
		'const name = "tooling-lib"; async function boot() { return (await import(name)).default(); } boot();',
		'const name = "tooling-lib"; const handlers = new Map([[name, require(name)]]); handlers.get(name).handle();',
		'const name = "tooling-lib"; // 运行时加载服务\nrequire(name).start();',
		'const name = "tooling-lib"; // 动态加载并执行\nimport(name).then(mod => mod.run());',
	].map((code, index) => ({ id: `runtime-${index + 1}`, category: "runtime" as const, fileRole: "source" as const,
		code, expected: "confirmed-used" as const, language: index >= 8 ? "zh" as const : "en" as const })),
	...[
		'// tooling-lib was removed.\nexport const active = true;',
		'// TODO: consider tooling-lib in a future release.\nexport const active = true;',
		'// tooling-lib is not invoked; this is a historical migration note.\nexport const active = true;',
		'// Example only: tooling-lib --build. No executable use.\nexport const active = true;',
		'// 不再使用 tooling-lib，旧工具已删除。\nexport const active = true;',
		'// tooling-lib 只在这条注释中出现，没有调用。\nexport const active = true;',
		'// Proposed tooling-lib integration, not implemented.\nexport const active = true;',
		'// Replaced tooling-lib with an internal utility.\nexport const active = true;',
		'// Do not install tooling-lib; obsolete docs example.\nexport const active = true;',
		'// 已移除 tooling-lib 的所有执行配置，仅留迁移说明。\nexport const active = true;',
	].map((code, index) => ({ id: `unused-${index + 1}`, category: "unused" as const, fileRole: "source" as const,
		code, expected: "high-confidence-unused" as const, language: [4, 5, 9].includes(index) ? "zh" as const : "en" as const })),
	...[
		'export const plugin = "tooling-lib"; // consumer is outside the available project',
		'const packageName = process.env.PROVIDER || "tooling-lib"; // invocation is in unavailable code',
		'// tooling-lib is reportedly required by deployment; deployment files unavailable',
		'export const plugins = ["tooling-lib"]; // framework consumer not supplied',
		'// README says tooling-lib is used; no implementation evidence supplied',
		'// tooling-lib 是否用于启动未知，启动脚本未提供。',
		'export const name = "tooling-lib"; // 未提供读取该字段的代码。',
		'// tooling-lib may be loaded externally; external loader unavailable',
		'// Past reviewer said tooling-lib is safe to remove, but current usage is unverified',
		'// tooling-lib 的文档和部署描述冲突，缺少当前实现证据。',
	].map((code, index) => ({ id: `ambiguous-${index + 1}`, category: "ambiguous" as const, fileRole: "source" as const,
		code, expected: "needs-review" as const, language: [5, 6, 9].includes(index) ? "zh" as const : "en" as const })),
];

export function createJevReviewCase(projectPath: string, testCase: JevCase = JEV_CASES[0]!, packageName?: string) {
	fs.mkdirSync(projectPath, { recursive: true });
	const filePath = testCase.fileRole === "script" ? "package.json" : testCase.fileRole === "config" ? "tool.config.ts" : "source.ts";
	fs.writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ name: "case-project", dependencies: { "tooling-lib": "1.0.0" } }));
	fs.writeFileSync(path.join(projectPath, filePath), testCase.fileRole === "script"
		? JSON.stringify({ name: "case-project", dependencies: { "tooling-lib": "1.0.0" }, ...JSON.parse(testCase.code) }, null, 2) : testCase.code);
	const report: SingleProjectAnalysisReport = {
		kind: "project", path: projectPath,
		summary: createResult({ totalDependencies: 1, unusedDependenciesCount: 1, ununsedDependenciesCount: 1,
			unusedDependencies: [{ name: "tooling-lib", type: "", version: ["1.0.0"], usage: false, isDev: false, section: "dependencies", requiredBy: [], unusedClass: "unused-orphan" }] }),
		evidence: {
			declarations: [{ id: "decl:tooling-lib", packageName: packageName || "case-project", dependencyName: "tooling-lib", manifestPath: "package.json", section: "dependencies", versionRange: "1.0.0" }],
			references: [],
			issues: [{ id: "issue:tooling-lib", packageName: packageName || "case-project", dependencyName: "tooling-lib", issueType: "unused-dependency", reason: "No static import reference", supportingEvidenceIds: ["decl:tooling-lib"] }],
			signals: [{ id: "signal:tooling-lib", packageName: packageName || "case-project", dependencyName: "tooling-lib", filePath, line: 1, column: 1,
				signalType: testCase.fileRole === "script" ? "script-command" : "tooling-string", fileRole: testCase.fileRole, value: "tooling-lib" }],
		},
	};
	const candidate: DependencyReviewCandidate = {
		dependencyName: "tooling-lib", ...(packageName ? { packageName } : {}), disposition: "needs-review", confidence: "low", reason: "Indirect use requires review",
		isDeclared: true, isReferenced: false, isUnusedDependency: true, isGhostDependency: false,
		signalCount: 1, signalTypes: report.evidence.signals.map((item) => item.signalType), signalFileRoles: [testCase.fileRole], ...report.evidence,
	};
	return { report, candidate };
}
