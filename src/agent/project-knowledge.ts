import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
	ProjectKnowledgeChunk,
	ProjectKnowledgeFileIndex,
	ProjectKnowledgeHit,
	ProjectKnowledgeStore,
	SignalEvidence,
} from "../types";

const KNOWLEDGE_VERSION = 1;
const MAX_CHUNK_LENGTH = 900;

function getKnowledgeDir(projectPath: string): string {
	return path.join(projectPath, ".deplens");
}

function getKnowledgeFilePath(projectPath: string): string {
	return path.join(getKnowledgeDir(projectPath), "knowledge.json");
}

function defaultStore(): ProjectKnowledgeStore {
	return {
		version: KNOWLEDGE_VERSION,
		files: [],
	};
}

function safeReadFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}

function sha1(content: string): string {
	return crypto.createHash("sha1").update(content).digest("hex");
}

function chunkText(rawText: string): string[] {
	const text = rawText.replace(/\r\n/g, "\n").trim();
	if (text === "") {
		return [];
	}

	const parts = text.split(/\n\s*\n/g).map((item) => item.trim()).filter(Boolean);
	const chunks: string[] = [];
	let buffer = "";

	for (const part of parts) {
		if (buffer.length === 0) {
			buffer = part;
			continue;
		}

		if ((buffer.length + part.length + 2) <= MAX_CHUNK_LENGTH) {
			buffer = `${buffer}\n\n${part}`;
			continue;
		}

		chunks.push(buffer);
		if (part.length <= MAX_CHUNK_LENGTH) {
			buffer = part;
			continue;
		}

		for (let index = 0; index < part.length; index += MAX_CHUNK_LENGTH) {
			chunks.push(part.slice(index, index + MAX_CHUNK_LENGTH));
		}
		buffer = "";
	}

	if (buffer.length > 0) {
		chunks.push(buffer);
	}

	return chunks;
}

function extractTags(filePath: string, text: string): string[] {
	const tags = new Set<string>();
	const lower = text.toLowerCase();
	const fileName = path.basename(filePath).toLowerCase();
	const tokenPattern = /@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+(?:-[a-z0-9._-]+)+/gi;
	let match: RegExpExecArray | null;

	while ((match = tokenPattern.exec(text)) !== null) {
		tags.add(match[0].toLowerCase());
	}

	for (const keyword of ["script", "config", "tool", "tooling", "plugin", "preset", "build", "start", "dev", "test", "service", "cli"]) {
		if (lower.includes(keyword)) {
			tags.add(keyword);
		}
	}

	if (fileName === "readme.md") {
		tags.add("readme");
	}
	if (fileName === "agents.md") {
		tags.add("agents");
	}
	if (fileName === "deplens.config.json") {
		tags.add("deplens-config");
	}

	return Array.from(tags).sort();
}

function buildFileIndex(projectPath: string, filePath: string): ProjectKnowledgeFileIndex | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}

	const rawText = safeReadFile(filePath);
	if (rawText.trim() === "") {
		return null;
	}

	const stat = fs.statSync(filePath);
	const relativePath = path.relative(projectPath, filePath) || path.basename(filePath);
	const fileHash = sha1(rawText);
	const indexedAt = new Date().toISOString();
	const updatedAt = new Date(stat.mtimeMs).toISOString();
	const chunks = chunkText(rawText).map((text, index) => ({
		id: `knowledge:${relativePath}:${index + 1}:${fileHash.slice(0, 8)}`,
		filePath: relativePath,
		title: `${relativePath}#${index + 1}`,
		text,
		hash: sha1(text),
		updatedAt,
		indexedAt,
		tags: extractTags(relativePath, text),
	}));

	return {
		filePath: relativePath,
		hash: fileHash,
		updatedAt,
		indexedAt,
		chunks,
	};
}

function listRuleMarkdownFiles(projectPath: string): string[] {
	const rulesDir = path.join(projectPath, ".deplens", "rules");
	if (!fs.existsSync(rulesDir)) {
		return [];
	}

	const files: string[] = [];
	const stack = [rulesDir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const nextPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(nextPath);
				continue;
			}
			if (entry.isFile() && nextPath.toLowerCase().endsWith(".md")) {
				files.push(nextPath);
			}
		}
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function getKnowledgeSourceFiles(projectPath: string): string[] {
	return [
		path.join(projectPath, "README.md"),
		path.join(projectPath, "AGENTS.md"),
		path.join(projectPath, "deplens.config.json"),
		...listRuleMarkdownFiles(projectPath),
	].filter((filePath, index, list) => list.indexOf(filePath) === index);
}

export function readProjectKnowledgeStore(projectPath: string): ProjectKnowledgeStore {
	const filePath = getKnowledgeFilePath(projectPath);
	if (!fs.existsSync(filePath)) {
		return defaultStore();
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProjectKnowledgeStore;
		if (parsed.version !== KNOWLEDGE_VERSION || !Array.isArray(parsed.files)) {
			return defaultStore();
		}
		return parsed;
	} catch {
		return defaultStore();
	}
}

export function writeProjectKnowledgeStore(projectPath: string, store: ProjectKnowledgeStore): void {
	fs.mkdirSync(getKnowledgeDir(projectPath), { recursive: true });
	fs.writeFileSync(getKnowledgeFilePath(projectPath), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function syncProjectKnowledgeStore(projectPath: string): ProjectKnowledgeStore {
	const files = getKnowledgeSourceFiles(projectPath)
		.map((filePath) => buildFileIndex(projectPath, filePath))
		.filter((item): item is ProjectKnowledgeFileIndex => !!item);
	const store: ProjectKnowledgeStore = {
		version: KNOWLEDGE_VERSION,
		files,
	};
	writeProjectKnowledgeStore(projectPath, store);
	return store;
}

function scoreRoleHint(tags: string[], signalRoles: SignalEvidence["fileRole"][]): number {
	const tagSet = new Set(tags);
	let score = 0;
	if (signalRoles.includes("script") && (tagSet.has("script") || tagSet.has("start") || tagSet.has("build"))) {
		score += 3;
	}
	if ((signalRoles.includes("config") || signalRoles.includes("tooling")) && (tagSet.has("config") || tagSet.has("tool") || tagSet.has("tooling") || tagSet.has("plugin") || tagSet.has("preset"))) {
		score += 3;
	}
	return score;
}

export function searchProjectKnowledge(
	projectPath: string,
	input: {
		dependencyName: string;
		packageName?: string;
		signalTypes?: SignalEvidence["signalType"][];
		signalRoles?: SignalEvidence["fileRole"][];
		limit?: number;
	}
): ProjectKnowledgeHit[] {
	const store = syncProjectKnowledgeStore(projectPath);
	const now = Date.now();
	const dependencyName = input.dependencyName.toLowerCase();
	const packageName = input.packageName?.toLowerCase();
	const signalTypes = input.signalTypes || [];
	const signalRoles = input.signalRoles || [];
	const limit = Math.max(1, input.limit || 5);

	return store.files
		.flatMap((file) => file.chunks)
		.map((chunk) => {
			const lower = chunk.text.toLowerCase();
			let score = 0;
			const matchedFields: string[] = [];
			if (lower.includes(dependencyName)) {
				score += 12;
				matchedFields.push("dependencyName");
			}
			if (packageName && lower.includes(packageName)) {
				score += 4;
				matchedFields.push("packageName");
			}
			for (const signalType of signalTypes) {
				if (chunk.tags.includes(signalType.toLowerCase())) {
					score += 2;
					matchedFields.push(`signalType:${signalType}`);
				}
			}
			score += scoreRoleHint(chunk.tags, signalRoles);
			const ageDays = Math.max(0, now - new Date(chunk.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
			const freshnessBonus = Math.max(0, 3 - Math.floor(ageDays / 30));
			score += freshnessBonus;
			if (chunk.filePath.toLowerCase().includes(".deplens\\rules")) {
				score += 2;
			}
			return {
				chunk,
				score,
				matchedFields,
			};
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}
