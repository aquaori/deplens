import fs from "fs";
import path from "path";
import {
	AgentMemoryEntry,
	AgentMemoryHit,
	AgentMemoryStore,
	AnalysisReport,
	DependencyOverview,
	FallbackReason,
	SignalEvidence,
} from "../types";

function getProjectRoot(report: AnalysisReport): string {
	return report.kind === "project" ? report.path : report.projectPath;
}

function getMemoryDir(projectPath: string): string {
	return path.join(projectPath, ".deplens");
}

export function getMemoryFilePath(projectPath: string): string {
	return path.join(getMemoryDir(projectPath), "memory.json");
}

function defaultStore(): AgentMemoryStore {
	return {
		version: 1,
		entries: [],
	};
}

export function readAgentMemory(projectPath: string): AgentMemoryStore {
	const filePath = getMemoryFilePath(projectPath);
	if (!fs.existsSync(filePath)) {
		return defaultStore();
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentMemoryStore;
		if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
			return defaultStore();
		}
		return parsed;
	} catch {
		return defaultStore();
	}
}

export function writeAgentMemory(projectPath: string, store: AgentMemoryStore): void {
	const dirPath = getMemoryDir(projectPath);
	fs.mkdirSync(dirPath, { recursive: true });
	fs.writeFileSync(getMemoryFilePath(projectPath), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function scoreSignalTypes(current: SignalEvidence["signalType"][], candidate: SignalEvidence["signalType"][]): number {
	const currentSet = new Set(current);
	return candidate.reduce((score, item) => score + (currentSet.has(item) ? 1 : 0), 0);
}

function buildMatchedFields(entry: AgentMemoryEntry, dependencyName?: string, packageName?: string): string[] {
	const fields: string[] = [];
	if (dependencyName && entry.dependencyName === dependencyName) {
		fields.push("dependencyName");
	}
	if (packageName && entry.packageName === packageName) {
		fields.push("packageName");
	}
	return fields;
}

export function findRelevantMemory(
	report: AnalysisReport,
	overview: DependencyOverview,
	limit: number = 5
): AgentMemoryHit[] {
	const projectPath = getProjectRoot(report);
	const store = readAgentMemory(projectPath);
	const now = Date.now();

	return store.entries
		.map((entry) => {
			let score = 0;
			if (entry.dependencyName === overview.dependencyName) {
				score += 10;
			}
			if (entry.packageName && entry.packageName === overview.packageName) {
				score += 5;
			}
			if (entry.signalTypes && entry.signalTypes.length > 0) {
				score += scoreSignalTypes(overview.signals.map((item) => item.signalType), entry.signalTypes);
			}
			const ageMs = Math.max(0, now - new Date(entry.updatedAt).getTime());
			const ageDays = ageMs / (1000 * 60 * 60 * 24);
			score += Math.max(0, entry.decayWeight - Math.floor(ageDays / 7));
			return {
				entry,
				score,
				matchedFields: buildMatchedFields(entry, overview.dependencyName, overview.packageName),
			};
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.max(1, limit));
}

export interface AgentMemoryWriteInput {
	report: AnalysisReport;
	dependencyName?: string;
	packageName?: string;
	disposition?: AgentMemoryEntry["disposition"];
	confidence?: AgentMemoryEntry["confidence"];
	issueTypes?: AgentMemoryEntry["issueTypes"];
	signalTypes?: AgentMemoryEntry["signalTypes"];
	filePaths?: string[];
	evidenceIds?: string[];
	parseStatus?: AgentMemoryEntry["parseStatus"];
	fallbackReason?: FallbackReason;
	deepAnalysisUsed?: boolean;
	maxEntries?: number;
}

export function appendAgentMemory(input: AgentMemoryWriteInput): void {
	const projectPath = getProjectRoot(input.report);
	const store = readAgentMemory(projectPath);
	const now = new Date().toISOString();
	const id = [
		input.packageName || "",
		input.dependencyName || "",
		input.disposition || "",
		now,
	].join("::");

	const entry: AgentMemoryEntry = {
		id,
		createdAt: now,
		updatedAt: now,
		projectPath,
		useCount: 1,
		decayWeight: 10,
	};
	if (input.dependencyName) {
		entry.dependencyName = input.dependencyName;
	}
	if (input.packageName) {
		entry.packageName = input.packageName;
	}
	if (input.disposition) {
		entry.disposition = input.disposition;
	}
	if (input.confidence) {
		entry.confidence = input.confidence;
	}
	if (input.issueTypes) {
		entry.issueTypes = input.issueTypes;
	}
	if (input.signalTypes) {
		entry.signalTypes = input.signalTypes;
	}
	if (input.filePaths) {
		entry.filePaths = input.filePaths;
	}
	if (input.evidenceIds) {
		entry.evidenceIds = input.evidenceIds;
	}
	if (input.parseStatus) {
		entry.parseStatus = input.parseStatus;
	}
	if (input.fallbackReason) {
		entry.fallbackReason = input.fallbackReason;
	}
	if (typeof input.deepAnalysisUsed === "boolean") {
		entry.deepAnalysisUsed = input.deepAnalysisUsed;
	}

	store.entries = [entry, ...store.entries].slice(0, Math.max(1, input.maxEntries || 100));
	writeAgentMemory(projectPath, store);
}
