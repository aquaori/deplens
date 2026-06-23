import fs from "fs";
import path from "path";
import { AgentProjectConfig } from "../types";

const DEFAULT_AGENT_PROJECT_CONFIG: AgentProjectConfig = {
	output: {
		strictValidation: true,
	},
	memory: {
		enabled: true,
		maxEntries: 100,
	},
	review: {
		maxRounds: 6,
		knowledge: {
			enabled: true,
			maxHits: 4,
		},
		confidence: {
			staticWeight: 1,
			modelWeight: 1,
			knowledgeWeight: 0.45,
			conservativeMargin: 0.08,
		},
	},
	telemetry: {
		enabled: true,
		maxRuns: 200,
	},
};

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function sanitizePositiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: fallback;
}

function sanitizePositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

export function getProjectConfigPath(projectPath: string): string {
	return path.join(projectPath, "deplens.config.json");
}

export function readAgentProjectConfig(projectPath: string): AgentProjectConfig {
	const configPath = getProjectConfigPath(projectPath);
	if (!fs.existsSync(configPath)) {
		return DEFAULT_AGENT_PROJECT_CONFIG;
	}

	try {
		const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
		const agent = isObjectLike(raw["agent"]) ? raw["agent"] : {};
		const output = isObjectLike(agent["output"]) ? agent["output"] : {};
		const memory = isObjectLike(agent["memory"]) ? agent["memory"] : {};
		const review = isObjectLike(agent["review"]) ? agent["review"] : {};
		const knowledge = isObjectLike(review["knowledge"]) ? review["knowledge"] : {};
		const confidence = isObjectLike(review["confidence"]) ? review["confidence"] : {};
		const telemetry = isObjectLike(agent["telemetry"]) ? agent["telemetry"] : {};
		return {
			output: {
				strictValidation: sanitizeBoolean(
					output["strictValidation"],
					DEFAULT_AGENT_PROJECT_CONFIG.output.strictValidation
				),
			},
			memory: {
				enabled: sanitizeBoolean(
					memory["enabled"],
					DEFAULT_AGENT_PROJECT_CONFIG.memory.enabled
				),
				maxEntries: sanitizePositiveInteger(
					memory["maxEntries"],
					DEFAULT_AGENT_PROJECT_CONFIG.memory.maxEntries
				),
			},
			review: {
				maxRounds: sanitizePositiveInteger(
					review["maxRounds"],
					DEFAULT_AGENT_PROJECT_CONFIG.review.maxRounds
				),
				knowledge: {
					enabled: sanitizeBoolean(
						knowledge["enabled"],
						DEFAULT_AGENT_PROJECT_CONFIG.review.knowledge.enabled
					),
					maxHits: sanitizePositiveInteger(
						knowledge["maxHits"],
						DEFAULT_AGENT_PROJECT_CONFIG.review.knowledge.maxHits
					),
				},
				confidence: {
					staticWeight: sanitizePositiveNumber(
						confidence["staticWeight"],
						DEFAULT_AGENT_PROJECT_CONFIG.review.confidence.staticWeight
					),
					modelWeight: sanitizePositiveNumber(
						confidence["modelWeight"],
						DEFAULT_AGENT_PROJECT_CONFIG.review.confidence.modelWeight
					),
					knowledgeWeight: sanitizePositiveNumber(
						confidence["knowledgeWeight"],
						DEFAULT_AGENT_PROJECT_CONFIG.review.confidence.knowledgeWeight
					),
					conservativeMargin: sanitizePositiveNumber(
						confidence["conservativeMargin"],
						DEFAULT_AGENT_PROJECT_CONFIG.review.confidence.conservativeMargin
					),
				},
			},
			telemetry: {
				enabled: sanitizeBoolean(
					telemetry["enabled"],
					DEFAULT_AGENT_PROJECT_CONFIG.telemetry.enabled
				),
				maxRuns: sanitizePositiveInteger(
					telemetry["maxRuns"],
					DEFAULT_AGENT_PROJECT_CONFIG.telemetry.maxRuns
				),
			},
		};
	} catch {
		return DEFAULT_AGENT_PROJECT_CONFIG;
	}
}

export function getDefaultAgentProjectConfig(): AgentProjectConfig {
	return DEFAULT_AGENT_PROJECT_CONFIG;
}
