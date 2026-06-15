import fs from "fs";
import os from "os";
import path from "path";
import { reviewCandidateWithWorkflow } from "../../src/agent/review-workflow";
import { SingleProjectAnalysisReport } from "../../src/types";

function createReport(projectPath: string): SingleProjectAnalysisReport {
	return {
		kind: "project",
		path: projectPath,
		summary: {
			usedDependencies: 0,
			unusedDependencies: [
				{
					name: "tooling-lib",
					type: "",
					version: {},
					usage: false,
					isDev: false,
				},
			],
			ununsedDependenciesCount: 1,
			totalDependencies: 1,
			devDependencies: [],
		},
		evidence: {
			declarations: [
				{
					id: "decl:tooling-lib",
					packageName: "project",
					dependencyName: "tooling-lib",
					manifestPath: "package.json",
					section: "dependencies",
					versionRange: "1.0.0",
				},
			],
			references: [],
			issues: [
				{
					id: "issue:tooling-lib",
					packageName: "project",
					dependencyName: "tooling-lib",
					issueType: "unused-dependency",
					reason: "unused",
					supportingEvidenceIds: ["decl:tooling-lib"],
				},
			],
			signals: [
				{
					id: "signal:tooling-lib",
					packageName: "project",
					dependencyName: "tooling-lib",
					filePath: "src/config.ts",
					line: 1,
					column: 1,
					signalType: "tooling-string",
					fileRole: "config",
					value: "tooling-lib",
				},
			],
		},
	};
}

describe("agent review workflow", () => {
	it("falls back to the deterministic candidate when the model returns invalid json", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-agent-"));
		const report = createReport(tempDir);
		const candidate = {
			dependencyName: "tooling-lib",
			disposition: "likely-tooling-usage" as const,
			confidence: "medium" as const,
			reason: "tooling signal",
			isDeclared: true,
			isReferenced: false,
			isUnusedDependency: true,
			isGhostDependency: false,
			signalCount: 1,
			signalTypes: ["tooling-string" as const],
			signalFileRoles: ["config" as const],
			declarations: report.evidence.declarations,
			references: [],
			issues: report.evidence.issues,
			signals: report.evidence.signals,
		};
		const overview = {
			dependencyName: "tooling-lib",
			declarations: report.evidence.declarations,
			references: [],
			issues: report.evidence.issues,
			signals: report.evidence.signals,
			isDeclared: true,
			isReferenced: false,
			hasSignals: true,
			isGhostDependency: false,
			isUnusedDependency: true,
			isUndeclaredWorkspaceDependency: false,
			referencedByPackages: [],
			referencedFiles: [],
		};
		const contextBundle = {
			dependencyName: "tooling-lib",
			snippetCount: 0,
			signalCount: 1,
			referenceCount: 0,
			snippets: [],
		};
		const model = {
			invoke: jest.fn()
				.mockResolvedValueOnce({
					content: '{"action":"finalize_review","reason":"no more useful steps"}',
				})
				.mockResolvedValueOnce({
					content: "{ invalid json",
				}),
		};

		const result = await reviewCandidateWithWorkflow(
			report,
			model as any,
			candidate,
			overview,
			contextBundle,
			true,
			10
		);

		expect(result.candidate.disposition).toBe("likely-tooling-usage");
		expect(result.candidate.confidence).toBe("medium");
		expect(result.candidate.reviewFallbackUsed).toBe(true);
		expect(result.candidate.reviewParseStatus).toBe("invalid-json");
	});
});
