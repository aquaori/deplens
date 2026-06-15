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
		};
	} catch {
		return DEFAULT_AGENT_PROJECT_CONFIG;
	}
}

export function getDefaultAgentProjectConfig(): AgentProjectConfig {
	return DEFAULT_AGENT_PROJECT_CONFIG;
}
