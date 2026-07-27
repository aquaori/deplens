import fs from "fs";
import os from "os";
import path from "path";
import { appendAgentMemory, readAgentMemory } from "../../src/agent/memory";
import { SingleProjectAnalysisReport } from "../../src/types";
import { createResult } from "../helpers/result";

function createReport(projectPath: string): SingleProjectAnalysisReport {
	return {
		kind: "project",
		path: projectPath,
		summary: createResult(),
		evidence: { declarations: [], references: [], issues: [], signals: [] },
	};
}

describe("agent memory", () => {
	it("merges repeated reviews of the same dependency instead of appending duplicates", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-memory-"));
		const report = createReport(tempDir);

		appendAgentMemory({ report, dependencyName: "tooling-lib", disposition: "needs-review" });
		appendAgentMemory({ report, dependencyName: "tooling-lib", disposition: "likely-tooling-usage" });
		appendAgentMemory({ report, dependencyName: "other-lib", disposition: "needs-review" });

		const store = readAgentMemory(tempDir);
		const toolingEntries = store.entries.filter((item) => item.dependencyName === "tooling-lib");

		expect(toolingEntries).toHaveLength(1);
		expect(toolingEntries[0]!.disposition).toBe("likely-tooling-usage");
		// useCount 之前恒为 1，这个字段等于摆设。
		expect(toolingEntries[0]!.useCount).toBe(2);
		expect(store.entries).toHaveLength(2);

		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("keeps the earliest createdAt while refreshing updatedAt", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-memory-"));
		const report = createReport(tempDir);

		appendAgentMemory({ report, dependencyName: "lib", disposition: "needs-review" });
		const first = readAgentMemory(tempDir).entries[0]!;
		appendAgentMemory({ report, dependencyName: "lib", disposition: "confirmed-used" });
		const second = readAgentMemory(tempDir).entries[0]!;

		expect(second.createdAt).toBe(first.createdAt);
		expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(
			new Date(first.updatedAt).getTime()
		);

		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
