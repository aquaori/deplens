import {
	buildContextBundleAnswer,
	buildDependencyNameListAnswer,
} from "../../src/agent/answer-builder";
import { DependencyContextBundle } from "../../src/types";

describe("agent answer builder", () => {
	it("maps suggestion intents to natural-language suggestions without fake commands", () => {
		const answer = buildDependencyNameListAnswer(
			"Unused Dependency Screening",
			"Screening only.",
			["left-pad"],
			"en",
			["review_unused_dependencies", "manual_verify_before_remove"]
		);

		expect(answer.type).toBe("dependency_list");
		expect(answer.suggestions).toEqual([
			"Treat unused dependency results as a screening view and confirm removals one by one.",
			"Verify manually before removal, especially scripts, config, and runtime conventions.",
		]);
		expect(answer.suggestions?.join(" ")).not.toMatch(/deplens|npm|pnpm|npx/i);
	});

	it("builds stable code-context sections from snippets", () => {
		const bundle: DependencyContextBundle = {
			dependencyName: "tooling-lib",
			snippetCount: 1,
			signalCount: 1,
			referenceCount: 0,
			snippets: [
				{
					filePath: "src/config.ts",
					lineStart: 1,
					lineEnd: 3,
					focusLine: 2,
					origin: "signal",
					fileRole: "config",
					summary: "tooling-string signal",
					code: ">    2 | tooling-lib",
				},
			],
		};

		const answer = buildContextBundleAnswer(bundle, "en");
		expect(answer.type).toBe("code_context");
		expect(answer.sections.some((section) => section.type === "code")).toBe(true);
	});
});
