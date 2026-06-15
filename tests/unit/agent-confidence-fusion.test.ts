import { fuseReviewConfidence } from "../../src/agent/confidence-fusion";
import { DependencyReviewCandidate } from "../../src/types";

function createCandidate(overrides: Partial<DependencyReviewCandidate> = {}): DependencyReviewCandidate {
	return {
		dependencyName: "tooling-lib",
		disposition: "likely-tooling-usage",
		confidence: "medium",
		reason: "tooling signal",
		isDeclared: true,
		isReferenced: false,
		isUnusedDependency: true,
		isGhostDependency: false,
		signalCount: 1,
		signalTypes: ["tooling-string"],
		signalFileRoles: ["config"],
		declarations: [],
		references: [],
		issues: [],
		signals: [],
		...overrides,
	};
}

describe("confidence fusion", () => {
	it("keeps the result bounded and conservative when the model has no valid evidence", () => {
		const result = fuseReviewConfidence({
			candidate: createCandidate(),
			modelVerdict: {
				verdict: "confirmed-used",
				confidence: "high",
				reason: "it is probably used",
				evidenceIds: ["missing:id"],
			},
			validEvidenceIds: [],
			knowledgeHits: [],
			knowledgeEvidenceIds: [],
		});

		expect(result.score).toBeGreaterThan(0);
		expect(result.score).toBeLessThan(1);
		expect(result.verdict).not.toBe("confirmed-used");
	});

	it("lets strong current evidence override a weak static prior", () => {
		const result = fuseReviewConfidence({
			candidate: createCandidate({
				disposition: "needs-review",
				confidence: "low",
				signalCount: 2,
			}),
			modelVerdict: {
				verdict: "confirmed-used",
				confidence: "high",
				reason: "real code evidence was found",
				evidenceIds: ["ref:1", "context:src/index.ts:12:reference"],
			},
			validEvidenceIds: ["ref:1", "context:src/index.ts:12:reference"],
			knowledgeHits: [],
			knowledgeEvidenceIds: [],
		});

		expect(result.verdict).toBe("confirmed-used");
		expect(result.confidence === "medium" || result.confidence === "high").toBe(true);
	});
});
