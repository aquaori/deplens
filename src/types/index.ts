export interface Dependency {
	name: string;
	type: string;
	version: object;
	usage: boolean;
	isDev: boolean;
	args?: string;
}

export interface Result {
	usedDependencies: number;
	unusedDependencies: Dependency[];
	ununsedDependenciesCount: number;
	totalDependencies: number;
	devDependencies: Dependency[];
}

export interface MonorepoPackageAnalysisReport {
	name: string;
	path: string;
	summary: Result | null;
	usedImports: string[];
	declaredDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	dynamicUnusedDependencies: string[];
}

export interface SingleProjectAnalysisReport {
	kind: "project";
	path: string;
	summary: Result;
}

export interface MonorepoAnalysisReport {
	kind: "monorepo";
	projectPath: string;
	monorepoType: "npm" | "pnpm" | "unknown";
	packageCount: number;
	packagesWithUnusedDependencies: number;
	packagesWithGhostDependencies: number;
	packagesWithoutUnusedDependencies: number;
	packages: MonorepoPackageAnalysisReport[];
}

export type AnalysisReport = SingleProjectAnalysisReport | MonorepoAnalysisReport;

export interface LogQueue {
	type: string;
	message: string;
}
