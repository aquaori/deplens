import fs from "fs";
import path from "path";
import {
	AgentRunSummaryEntry,
	AgentRunSummaryStore,
	AnalysisReport,
} from "../types";

function getProjectRoot(report: AnalysisReport): string {
	return report.kind === "project" ? report.path : report.projectPath;
}

function getTelemetryDir(projectPath: string): string {
	return path.join(projectPath, ".deplens");
}

export function getRunSummaryFilePath(projectPath: string): string {
	return path.join(getTelemetryDir(projectPath), "runs.json");
}

function defaultStore(): AgentRunSummaryStore {
	return {
		version: 1,
		entries: [],
	};
}

export function readRunSummaryStore(projectPath: string): AgentRunSummaryStore {
	const filePath = getRunSummaryFilePath(projectPath);
	if (!fs.existsSync(filePath)) {
		return defaultStore();
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentRunSummaryStore;
		if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
			return defaultStore();
		}
		return parsed;
	} catch {
		return defaultStore();
	}
}

export function appendRunSummary(
	report: AnalysisReport,
	entry: Omit<AgentRunSummaryEntry, "id" | "createdAt" | "projectPath">,
	maxRuns: number
): void {
	const projectPath = getProjectRoot(report);
	const filePath = getRunSummaryFilePath(projectPath);
	const store = readRunSummaryStore(projectPath);
	const createdAt = new Date().toISOString();
	const nextEntry: AgentRunSummaryEntry = {
		id: [
			entry.packageName || "",
			entry.dependencyName || "",
			createdAt,
		].join("::"),
		createdAt,
		projectPath,
		...entry,
	};

	store.entries = [nextEntry, ...store.entries].slice(0, Math.max(1, maxRuns));
	fs.mkdirSync(getTelemetryDir(projectPath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
