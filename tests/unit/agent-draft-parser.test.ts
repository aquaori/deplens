import {
	parseInvestigationActionDraft,
	parseNarrativeDraft,
	parseVerdictDraft,
} from "../../src/agent/draft-parser";

describe("agent draft parser", () => {
	it("reports missing markers for narrative drafts", () => {
		const result = parseNarrativeDraft('{"summary":"hello"}');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("missing-marker");
	});

	it("reports invalid json for malformed narrative drafts", () => {
		const result = parseNarrativeDraft("<deplens_draft>{ invalid }</deplens_draft>");
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("invalid-json");
	});

	it("reports invalid schema for malformed narrative shape", () => {
		const result = parseNarrativeDraft('<deplens_draft>{"findings":["x"]}</deplens_draft>');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("invalid-schema");
	});

	it("parses compact narrative drafts without forcing analysis sections", () => {
		const result = parseNarrativeDraft('<deplens_draft>{"summary":"不客气。","displayStyle":"compact","accentTone":"success"}</deplens_draft>');
		expect(result.ok).toBe(true);
		expect(result.draft).toMatchObject({
			summary: "不客气。",
			displayStyle: "compact",
			accentTone: "success",
		});
	});

	it("parses valid verdict drafts", () => {
		const result = parseVerdictDraft('{"verdict":"likely-tooling-usage","confidence":"medium","reason":"tooling signal","evidenceIds":["signal:1"]}');
		expect(result.ok).toBe(true);
		expect(result.draft).toMatchObject({
			verdict: "likely-tooling-usage",
			confidence: "medium",
			reason: "tooling signal",
			evidenceIds: ["signal:1"],
		});
	});

	it("parses valid investigation action drafts", () => {
		const result = parseInvestigationActionDraft('{"action":"inspect_config","reason":"config evidence is still missing"}');
		expect(result.ok).toBe(true);
		expect(result.draft).toMatchObject({
			action: "inspect_config",
			reason: "config evidence is still missing",
		});
	});
});
