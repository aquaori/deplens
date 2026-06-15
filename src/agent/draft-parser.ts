import * as z from "zod";
import {
	DependencyReviewCandidate,
	FallbackReason,
	ReviewInvestigationActionDraft,
	ReviewNarrativeDraft,
	ReviewNextStepIntent,
	ReviewInvestigationActionName,
	ReviewVerdictDraft,
} from "../types";

const nextStepIntentSchema = z.enum([
	"inspect_context",
	"review_candidate",
	"ask_dependency_name",
	"manual_verify_before_remove",
	"check_problematic_packages",
	"review_unused_dependencies",
	"review_ghost_dependencies",
]);

const investigationActionSchema = z.enum([
	"inspect_summary",
	"inspect_scripts",
	"inspect_config",
	"inspect_code_context",
	"search_project_knowledge",
	"finalize_review",
]);

const investigationDraftSchema = z.object({
	action: investigationActionSchema,
	reason: z.string().trim().min(1),
});

const verdictDraftSchema = z.object({
	verdict: z.enum([
		"confirmed-used",
		"high-confidence-unused",
		"likely-tooling-usage",
		"needs-review",
		"ghost-dependency",
	]),
	confidence: z.enum(["low", "medium", "high"]),
	reason: z.string().trim().min(1),
	evidenceNotes: z.array(z.string().trim().min(1)).optional(),
	evidenceIds: z.array(z.string().trim().min(1)).optional(),
	nextStepIntent: nextStepIntentSchema.optional(),
});

const narrativeDraftSchema = z.object({
	summary: z.string().trim().min(1),
	findings: z.array(z.string().trim().min(1)).optional(),
	citations: z.array(z.string().trim().min(1)).optional(),
	nextActionIntent: z.array(nextStepIntentSchema).optional(),
});

export interface ParsedDraftResult<TDraft> {
	ok: boolean;
	draft?: TDraft;
	reason?: FallbackReason;
	rawText: string;
}

function extractJsonPayload(rawText: string, markerName: string): ParsedDraftResult<string> {
	const match = rawText.match(new RegExp(`<${markerName}>\\s*([\\s\\S]*?)\\s*</${markerName}>`, "i"));
	if (!match || !match[1]) {
		return {
			ok: false,
			reason: "missing-marker",
			rawText,
		};
	}

	return {
		ok: true,
		draft: match[1],
		rawText,
	};
}

function extractLooseJsonObject(rawText: string): ParsedDraftResult<string> {
	const trimmed = rawText.trim();
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");

	if (firstBrace < 0 || lastBrace <= firstBrace) {
		return {
			ok: false,
			reason: "missing-marker",
			rawText,
		};
	}

	return {
		ok: true,
		draft: trimmed.slice(firstBrace, lastBrace + 1),
		rawText,
	};
}

function parseJson<TDraft>(
	payload: ParsedDraftResult<string>,
	schema: { safeParse: (value: unknown) => { success: true; data: TDraft } | { success: false } }
): ParsedDraftResult<TDraft> {
	if (!payload.ok || !payload.draft) {
		return payload as ParsedDraftResult<TDraft>;
	}

	try {
		const parsed = JSON.parse(payload.draft) as unknown;
		const validated = schema.safeParse(parsed);
		if (!validated.success) {
			return {
				ok: false,
				reason: "invalid-schema",
				rawText: payload.rawText,
			};
		}
		return {
			ok: true,
			draft: validated.data,
			rawText: payload.rawText,
		};
	} catch {
		return {
			ok: false,
			reason: "invalid-json",
			rawText: payload.rawText,
		};
	}
}

export function parseVerdictDraft(rawText: string): ParsedDraftResult<ReviewVerdictDraft> {
	return parseJson(
		extractLooseJsonObject(rawText),
		verdictDraftSchema
	);
}

export function parseInvestigationActionDraft(rawText: string): ParsedDraftResult<ReviewInvestigationActionDraft> {
	return parseJson(
		extractLooseJsonObject(rawText),
		investigationDraftSchema
	);
}

export function parseNarrativeDraft(rawText: string): ParsedDraftResult<ReviewNarrativeDraft> {
	return parseJson(
		extractJsonPayload(rawText, "deplens_draft"),
		narrativeDraftSchema
	);
}

export function toCandidateParseStatus(
	reason?: FallbackReason
): DependencyReviewCandidate["reviewParseStatus"] {
	switch (reason) {
		case undefined:
			return "ok";
		case "missing-marker":
			return "missing-marker";
		case "invalid-json":
			return "invalid-json";
		case "invalid-schema":
		case "plain-text-fallback":
		case "deterministic-summary-fallback":
		case "candidate-default-fallback":
		default:
			return "invalid-schema";
	}
}

export function isRecognizedNextStepIntent(value: string): value is ReviewNextStepIntent {
	return nextStepIntentSchema.safeParse(value).success;
}

export function isRecognizedInvestigationAction(value: string): value is ReviewInvestigationActionName {
	return investigationActionSchema.safeParse(value).success;
}
