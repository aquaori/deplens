import fs from "fs";
import os from "os";
import path from "path";
import { appendRunSummary, getRunSummaryFilePath, readRunSummaryStore } from "../../src/agent/telemetry";
import { SingleProjectAnalysisReport } from "../../src/types";
import { createResult } from "../helpers/result";

function createReport(projectPath: string): SingleProjectAnalysisReport {
	return {
		kind: "project",
		path: projectPath,
		summary: createResult(),
		evidence: {
			declarations: [],
			references: [],
			issues: [],
			signals: [],
		},
	};
}

describe("agent telemetry", () => {
	it("persists bounded run summaries for calibration", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-runs-"));
		const report = createReport(tempDir);

		appendRunSummary(report, {
			dependencyName: "tooling-lib",
			originalDisposition: "needs-review",
			finalDisposition: "likely-tooling-usage",
			finalConfidence: "medium",
			finalScore: 0.71,
			reviewRounds: 2,
			parseStatus: "ok",
			fallbackUsed: false,
			memoryUsed: true,
			knowledgeHitCount: 1,
			validEvidenceCount: 2,
			confidenceBreakdown: ["static=needs-review@0.38"],
		}, 2);

		appendRunSummary(report, {
			dependencyName: "unused-lib",
			originalDisposition: "high-confidence-unused",
			finalDisposition: "high-confidence-unused",
			finalConfidence: "high",
			finalScore: 0.91,
			reviewRounds: 0,
			parseStatus: "ok",
			fallbackUsed: false,
			memoryUsed: false,
			knowledgeHitCount: 0,
			validEvidenceCount: 1,
			confidenceBreakdown: ["static=high-confidence-unused@0.90"],
		}, 2);

		const filePath = getRunSummaryFilePath(tempDir);
		expect(fs.existsSync(filePath)).toBe(true);
		expect(readRunSummaryStore(tempDir).entries).toHaveLength(2);
	});
});
