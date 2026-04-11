import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

export const AI_CONFIG_KEY_MAP = {
	apiKey: "QWEN_API_KEY",
	baseUrl: "QWEN_BASE_URL",
	model: "QWEN_MODEL",
} as const;

export type CliConfigKey = keyof typeof AI_CONFIG_KEY_MAP;
export type EnvConfigKey = typeof AI_CONFIG_KEY_MAP[CliConfigKey];

export interface StoredUserConfig {
	QWEN_API_KEY?: string;
	QWEN_BASE_URL?: string;
	QWEN_MODEL?: string;
}

const ENV_CONFIG_KEYS = Object.values(AI_CONFIG_KEY_MAP) as EnvConfigKey[];

let runtimeInitialized = false;

function getDefaultConfigRoot(): string {
	if (process.platform === "win32") {
		return process.env["APPDATA"] || path.join(os.homedir(), "AppData", "Roaming");
	}

	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support");
	}

	return process.env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
}

export function getUserConfigDir(): string {
	return path.join(getDefaultConfigRoot(), "deplens");
}

export function getUserConfigFilePath(): string {
	return path.join(getUserConfigDir(), "config.json");
}

function ensureConfigDirExists(): void {
	fs.mkdirSync(getUserConfigDir(), { recursive: true });
}

function removeConfigDirIfEmpty(): void {
	const configDir = getUserConfigDir();
	if (!fs.existsSync(configDir)) {
		return;
	}

	try {
		if (fs.readdirSync(configDir).length === 0) {
			fs.rmdirSync(configDir);
		}
	} catch {
		// Ignore cleanup errors.
	}
}

function sanitizeStoredConfig(input: unknown): StoredUserConfig {
	if (!input || typeof input !== "object") {
		return {};
	}

	const source = input as Record<string, unknown>;
	const next: StoredUserConfig = {};

	for (const key of ENV_CONFIG_KEYS) {
		const value = source[key];
		if (typeof value === "string" && value.trim() !== "") {
			next[key] = value;
		}
	}

	return next;
}

export function readUserConfig(): StoredUserConfig {
	const configPath = getUserConfigFilePath();
	if (!fs.existsSync(configPath)) {
		return {};
	}

	try {
		const raw = fs.readFileSync(configPath, "utf8");
		return sanitizeStoredConfig(JSON.parse(raw));
	} catch {
		return {};
	}
}

function writeUserConfig(config: StoredUserConfig): void {
	const next = sanitizeStoredConfig(config);
	if (Object.keys(next).length === 0) {
		const configPath = getUserConfigFilePath();
		if (fs.existsSync(configPath)) {
			fs.unlinkSync(configPath);
		}
		removeConfigDirIfEmpty();
		return;
	}

	ensureConfigDirExists();
	fs.writeFileSync(getUserConfigFilePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function readProjectEnvFile(cwd: string): StoredUserConfig {
	const envPath = path.join(cwd, ".env");
	if (!fs.existsSync(envPath)) {
		return {};
	}

	try {
		const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
		return sanitizeStoredConfig(parsed);
	} catch {
		return {};
	}
}

export function initializeRuntimeEnv(cwd: string = process.cwd()): void {
	if (runtimeInitialized) {
		return;
	}

	const userConfig = readUserConfig();
	const projectEnv = readProjectEnvFile(cwd);

	for (const key of ENV_CONFIG_KEYS) {
		const existingValue = process.env[key];
		if (typeof existingValue === "string" && existingValue.trim() !== "") {
			continue;
		}

		const userValue = userConfig[key];
		if (userValue) {
			process.env[key] = userValue;
			continue;
		}

		const projectValue = projectEnv[key];
		if (projectValue) {
			process.env[key] = projectValue;
		}
	}

	runtimeInitialized = true;
}

export function normalizeCliConfigKey(input: string): CliConfigKey | null {
	const normalized = input.trim().toLowerCase().replace(/[_-]/g, "");
	switch (normalized) {
		case "apikey":
			return "apiKey";
		case "baseurl":
			return "baseUrl";
		case "model":
			return "model";
		default:
			return null;
	}
}

export function toEnvConfigKey(key: CliConfigKey): EnvConfigKey {
	return AI_CONFIG_KEY_MAP[key];
}

export function toCliConfigKey(envKey: EnvConfigKey): CliConfigKey {
	const matched = (Object.entries(AI_CONFIG_KEY_MAP) as Array<[CliConfigKey, EnvConfigKey]>)
		.find(([, mappedEnvKey]) => mappedEnvKey === envKey);

	if (!matched) {
		throw new Error(`Unsupported environment config key: ${envKey}`);
	}

	return matched[0];
}

export function setUserConfigValue(key: CliConfigKey, value: string): StoredUserConfig {
	const nextValue = value.trim();
	if (nextValue === "") {
		throw new Error(`Configuration value for ${key} cannot be empty.`);
	}

	const config = readUserConfig();
	config[toEnvConfigKey(key)] = nextValue;
	writeUserConfig(config);
	return readUserConfig();
}

export function unsetUserConfigValue(key: CliConfigKey): StoredUserConfig {
	const config = readUserConfig();
	delete config[toEnvConfigKey(key)];
	writeUserConfig(config);
	return readUserConfig();
}

export function resetUserConfig(): void {
	writeUserConfig({});
}

export function getUserConfigValue(key: CliConfigKey): string | undefined {
	const config = readUserConfig();
	return config[toEnvConfigKey(key)];
}

export function getUserConfigEntries(): Array<{ key: CliConfigKey; envKey: EnvConfigKey; value?: string }> {
	const config = readUserConfig();
	return (Object.entries(AI_CONFIG_KEY_MAP) as Array<[CliConfigKey, EnvConfigKey]>).map(([key, envKey]) => {
		const value = config[envKey];
		return value === undefined
			? { key, envKey }
			: { key, envKey, value };
	});
}

export function maskConfigValue(key: CliConfigKey, value: string | undefined): string {
	if (!value) {
		return "(not set)";
	}

	if (key !== "apiKey") {
		return value;
	}

	if (value.length <= 8) {
		return "*".repeat(value.length);
	}

	return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export function buildMissingAiConfigGuidance(missingEnvKeys: string[]): string {
	const validMissingKeys = missingEnvKeys.filter((key): key is EnvConfigKey =>
		ENV_CONFIG_KEYS.includes(key as EnvConfigKey)
	);

	if (validMissingKeys.length === 0) {
		return "AI review configuration is incomplete.";
	}

	const lines = validMissingKeys.map((envKey) => {
		const cliKey = toCliConfigKey(envKey);
		return `deplens config set ${cliKey} <your_${cliKey}_value>`;
	});

	return [
		`AI review features require these settings: ${validMissingKeys.join(", ")}.`,
		"Recommended next step:",
		...lines,
		"You can also set standard environment variables or use a project-level .env file.",
	].join("\n");
}
