import {
	filterContextByAction,
	filterSignalsByAction,
} from "../../src/agent/review-workflow";
import { DependencyContextBundle, DependencyReviewCandidate } from "../../src/types";

function snippet(
	filePath: string,
	fileRole: DependencyContextBundle["snippets"][number]["fileRole"]
): DependencyContextBundle["snippets"][number] {
	return {
		filePath,
		lineStart: 1,
		lineEnd: 3,
		focusLine: 2,
		origin: "signal",
		fileRole,
		summary: `${fileRole} snippet`,
		code: "code",
	};
}

const contextBundle: DependencyContextBundle = {
	dependencyName: "tooling-lib",
	snippetCount: 4,
	signalCount: 4,
	referenceCount: 0,
	snippets: [
		snippet("package.json", "script"),
		snippet("vite.config.ts", "config"),
		snippet("build/plugin.ts", "tooling"),
		snippet("src/index.ts", "source"),
	],
};

function signal(
	filePath: string,
	fileRole: DependencyReviewCandidate["signals"][number]["fileRole"],
	signalType: DependencyReviewCandidate["signals"][number]["signalType"]
): DependencyReviewCandidate["signals"][number] {
	return {
		id: `signal:${filePath}:${signalType}`,
		packageName: "project",
		dependencyName: "tooling-lib",
		filePath,
		line: 1,
		column: 1,
		signalType,
		fileRole,
		value: "tooling-lib",
	};
}

const candidate = {
	signals: [
		signal("package.json", "script", "script-command"),
		signal("vite.config.ts", "config", "tooling-string"),
		signal("src/index.ts", "source", "string-literal"),
	],
} as DependencyReviewCandidate;

/**
 * 这些过滤器的谓词是「保留」语义。旧实现全部写反了，
 * 于是模型选择 inspect_scripts 时，系统喂给它的恰好是除脚本以外的所有证据。
 */
describe("investigation action filters", () => {
	it("inspect_scripts returns script evidence, not everything except scripts", () => {
		const context = filterContextByAction("inspect_scripts", contextBundle);
		expect(context.map((item) => item.filePath)).toEqual(["package.json"]);

		const signals = filterSignalsByAction("inspect_scripts", candidate);
		expect(signals.map((item) => item.filePath)).toEqual(["package.json"]);
	});

	it("inspect_config returns config and tooling evidence only", () => {
		const context = filterContextByAction("inspect_config", contextBundle);
		expect(context.map((item) => item.filePath).sort()).toEqual([
			"build/plugin.ts",
			"vite.config.ts",
		]);

		const signals = filterSignalsByAction("inspect_config", candidate);
		expect(signals.map((item) => item.filePath)).toEqual(["vite.config.ts"]);
	});

	it("inspect_code_context returns every snippet", () => {
		expect(filterContextByAction("inspect_code_context", contextBundle)).toHaveLength(4);
	});

	it("inspect_summary returns every signal", () => {
		expect(filterSignalsByAction("inspect_summary", candidate)).toHaveLength(3);
	});
});
