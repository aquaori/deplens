import {
	ConfidenceFusionInput,
	ConfidenceFusionResult,
	DependencyReviewCandidate,
	DependencyReviewDisposition,
	ReviewVerdictDraft,
} from "../types";

const LABELS: DependencyReviewDisposition[] = [
	"confirmed-used",
	"high-confidence-unused",
	"likely-tooling-usage",
	"needs-review",
	"ghost-dependency",
];

function clampProbability(value: number): number {
	return Math.min(0.999, Math.max(0.001, value));
}

function confidenceToPeak(confidence: ReviewVerdictDraft["confidence"] | DependencyReviewCandidate["confidence"]): number {
	switch (confidence) {
		case "high":
			return 0.86;
		case "medium":
			return 0.72;
		case "low":
		default:
			return 0.58;
	}
}

function remainderWeights(verdict: DependencyReviewDisposition): Partial<Record<DependencyReviewDisposition, number>> {
	switch (verdict) {
		case "confirmed-used":
			return {
				"likely-tooling-usage": 0.5,
				"needs-review": 0.35,
				"ghost-dependency": 0.15,
			};
		case "high-confidence-unused":
			return {
				"needs-review": 0.55,
				"likely-tooling-usage": 0.3,
				"confirmed-used": 0.15,
			};
		case "likely-tooling-usage":
			return {
				"confirmed-used": 0.35,
				"needs-review": 0.45,
				"high-confidence-unused": 0.2,
			};
		case "ghost-dependency":
			return {
				"confirmed-used": 0.4,
				"needs-review": 0.4,
				"likely-tooling-usage": 0.2,
			};
		case "needs-review":
		default:
			return {
				"likely-tooling-usage": 0.3,
				"high-confidence-unused": 0.25,
				"confirmed-used": 0.25,
				"ghost-dependency": 0.2,
			};
	}
}

function buildDistribution(
	verdict: DependencyReviewDisposition,
	confidence: ReviewVerdictDraft["confidence"] | DependencyReviewCandidate["confidence"]
): Record<DependencyReviewDisposition, number> {
	const peak = confidenceToPeak(confidence);
	const rest = 1 - peak;
	const weights = remainderWeights(verdict);
	const distribution = {
		"confirmed-used": 0,
		"high-confidence-unused": 0,
		"likely-tooling-usage": 0,
		"needs-review": 0,
		"ghost-dependency": 0,
	} satisfies Record<DependencyReviewDisposition, number>;

	distribution[verdict] = peak;
	let assigned = 0;
	for (const label of LABELS) {
		if (label === verdict) {
			continue;
		}
		const weight = weights[label] || 0;
		const value = rest * weight;
		distribution[label] = value;
		assigned += value;
	}
	if (assigned < rest) {
		distribution["needs-review"] += (rest - assigned);
	}
	for (const label of LABELS) {
		distribution[label] = clampProbability(distribution[label]);
	}
	return distribution;
}

function getStaticReliability(candidate: DependencyReviewCandidate): number {
	switch (candidate.disposition) {
		case "confirmed-used":
		case "ghost-dependency":
			return 0.92;
		case "high-confidence-unused":
			return candidate.signalCount > 0 ? 0.7 : 0.9;
		case "likely-tooling-usage":
			return 0.56;
		case "needs-review":
		default:
			return 0.38;
	}
}

function getModelReliability(input: ConfidenceFusionInput): number {
	const draft = input.modelVerdict;
	if (!draft) {
		return 0;
	}

	const citedCount = draft.evidenceIds?.length || 0;
	const validCount = input.validEvidenceIds.length;
	const citationRatio = citedCount > 0 ? validCount / citedCount : 0;
	const currentFactCount = input.validEvidenceIds.filter((id) => !id.startsWith("knowledge:") && !id.startsWith("memory:")).length;
	const knowledgeCount = input.knowledgeEvidenceIds.length;
	const evidenceSupport = Math.min(1, (currentFactCount * 0.3) + (knowledgeCount * 0.12));
	let reliability = 0.2 + (citationRatio * 0.35) + evidenceSupport;

	if (draft.verdict === "confirmed-used" && currentFactCount === 0) {
		reliability -= 0.28;
	}
	if (draft.verdict === "high-confidence-unused" && input.candidate.signalCount > 0 && currentFactCount === 0) {
		reliability -= 0.2;
	}
	if (draft.verdict !== input.candidate.disposition && validCount === 0) {
		reliability -= 0.18;
	}

	return Math.max(0.05, Math.min(0.92, reliability));
}

function buildKnowledgeDistribution(input: ConfidenceFusionInput): Record<DependencyReviewDisposition, number> {
	if (input.knowledgeHits.length === 0) {
		return buildDistribution("needs-review", "low");
	}

	const signals = {
		used: 0,
		tooling: 0,
		unused: 0,
		ghost: 0,
	};
	for (const hit of input.knowledgeHits) {
		const lower = hit.chunk.text.toLowerCase();
		if (/(start|runtime|service|server|boot|load)/.test(lower)) {
			signals.used += 1;
		}
		if (/(tool|tooling|plugin|preset|config|script|build|test|babel|vite|webpack|eslint|jest)/.test(lower)) {
			signals.tooling += 1;
		}
		if (/(remove|unused|dead|cleanup|legacy)/.test(lower)) {
			signals.unused += 1;
		}
		if (/(missing|undeclared|ghost)/.test(lower)) {
			signals.ghost += 1;
		}
	}

	const entries = [
		["confirmed-used", signals.used],
		["likely-tooling-usage", signals.tooling],
		["high-confidence-unused", signals.unused],
		["ghost-dependency", signals.ghost],
	] as Array<[DependencyReviewDisposition, number]>;
	const best = entries.sort((a, b) => b[1] - a[1])[0];
	if (!best || best[1] === 0) {
		return buildDistribution("needs-review", "low");
	}
	return buildDistribution(best[0], best[1] >= 2 ? "medium" : "low");
}

function getKnowledgeReliability(input: ConfidenceFusionInput): number {
	if (input.knowledgeHits.length === 0) {
		return 0;
	}

	const score = input.knowledgeHits.reduce((sum, item) => sum + item.score, 0) / input.knowledgeHits.length;
	const citationRatio = input.knowledgeHits.length > 0
		? input.knowledgeEvidenceIds.length / input.knowledgeHits.length
		: 0;
	return Math.max(0.08, Math.min(0.45, 0.12 + (score * 0.02) + (citationRatio * 0.18)));
}

function normalizeDistribution(scores: Record<DependencyReviewDisposition, number>): Record<DependencyReviewDisposition, number> {
	const total = LABELS.reduce((sum, label) => sum + scores[label], 0);
	const normalized = {
		"confirmed-used": 0,
		"high-confidence-unused": 0,
		"likely-tooling-usage": 0,
		"needs-review": 0,
		"ghost-dependency": 0,
	} satisfies Record<DependencyReviewDisposition, number>;

	for (const label of LABELS) {
		normalized[label] = scores[label] / total;
	}
	return normalized;
}

export function fuseReviewConfidence(input: ConfidenceFusionInput): ConfidenceFusionResult {
	const staticDistribution = buildDistribution(input.candidate.disposition, input.candidate.confidence);
	const modelDistribution = input.modelVerdict
		? buildDistribution(input.modelVerdict.verdict, input.modelVerdict.confidence)
		: buildDistribution(input.candidate.disposition, "low");
	const knowledgeDistribution = buildKnowledgeDistribution(input);
	const staticReliability = getStaticReliability(input.candidate);
	const modelReliability = getModelReliability(input);
	const knowledgeReliability = getKnowledgeReliability(input);
	const rawScores = {
		"confirmed-used": Math.log(1 / LABELS.length),
		"high-confidence-unused": Math.log(1 / LABELS.length),
		"likely-tooling-usage": Math.log(1 / LABELS.length),
		"needs-review": Math.log(1 / LABELS.length),
		"ghost-dependency": Math.log(1 / LABELS.length),
	} satisfies Record<DependencyReviewDisposition, number>;

	for (const label of LABELS) {
		rawScores[label] += staticReliability * Math.log(staticDistribution[label]);
		rawScores[label] += modelReliability * Math.log(modelDistribution[label]);
		rawScores[label] += knowledgeReliability * Math.log(knowledgeDistribution[label]);
	}

	const maxScore = Math.max(...LABELS.map((label) => rawScores[label]));
	const expScores = {
		"confirmed-used": 0,
		"high-confidence-unused": 0,
		"likely-tooling-usage": 0,
		"needs-review": 0,
		"ghost-dependency": 0,
	} satisfies Record<DependencyReviewDisposition, number>;
	for (const label of LABELS) {
		expScores[label] = Math.exp(rawScores[label] - maxScore);
	}
	const distribution = normalizeDistribution(expScores);
	const sorted = [...LABELS].sort((a, b) => distribution[b] - distribution[a]);
	const top = sorted[0] || "needs-review";
	const second = sorted[1] || "needs-review";
	const margin = distribution[top] - distribution[second];
	const verdict = margin < 0.08 ? "needs-review" : top;
	const score = distribution[verdict];
	const confidence = score >= 0.8
		? "high"
		: score >= 0.62
			? "medium"
			: "low";

	return {
		verdict,
		confidence,
		score,
		distribution,
		breakdown: [
			`static=${input.candidate.disposition}@${staticReliability.toFixed(2)}`,
			`model=${input.modelVerdict ? `${input.modelVerdict.verdict}@${modelReliability.toFixed(2)}` : "none@0.00"}`,
			`knowledge=${input.knowledgeHits.length}@${knowledgeReliability.toFixed(2)}`,
			`validEvidence=${input.validEvidenceIds.length}`,
			`margin=${margin.toFixed(2)}`,
		],
	};
}
