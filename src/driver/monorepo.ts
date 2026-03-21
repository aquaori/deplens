import fs from "fs";
import path from "path";
import glob from "fast-glob";
import yaml from "js-yaml";
import traverse from "@babel/traverse";
import chalk from "chalk";
import { ArgumentsCamelCase } from "yargs";
import cliProgress from "cli-progress";
import { parseAST } from "../analyzer/parser";
import { scan } from "../analyzer/scanner";
import { AnalysisReport, MonorepoAnalysisReport, Result } from "../types";
import { logInfo, logSecondary, logSuccess, logWarning } from "../utils/cli-utils";

type AnalyzeArgs = ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	silence: boolean;
	ignoreDep: string;
	ignorePath: string;
	ignoreFile: string;
	config: string;
	json: boolean;
	output: string;
}>;

type AnalyzeProjectFn = (
	args: AnalyzeArgs,
	showResult?: boolean
) => Promise<[] | [Result, AnalyzeArgs] | AnalysisReport>;

interface WorkspacePackage {
	name: string;
	dir: string;
	relativeDir: string;
	manifestPath: string;
	manifest: Record<string, any>;
}

interface MonorepoPackageReport {
	pkg: WorkspacePackage;
	summary: Result | null;
	usedImports: string[];
	declaredDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
}

function chunkItems(items: string[], size: number): string[][] {
	const chunks: string[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

function stripBom(content: string): string {
	return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function readJsonFile(filePath: string): Record<string, any> {
	try {
		const rawContent = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(stripBom(rawContent)) as Record<string, any>;
	} catch (error) {
		throw new Error(
			`Failed to parse JSON file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function getWorkspaceYamlPath(projectPath: string): string | null {
	const candidates = ["pnpm-workspace.yaml", "pnpm-monorepo.yaml"];
	for (const candidate of candidates) {
		const fullPath = path.join(projectPath, candidate);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}
	return null;
}

function hasWorkspaceField(packageJsonPath: string): boolean {
	if (!fs.existsSync(packageJsonPath)) return false;
	const packageJson = readJsonFile(packageJsonPath);
	return Boolean(packageJson["workspaces"]);
}

function isMonorepo(projectPath: string): boolean {
	return Boolean(
		getWorkspaceYamlPath(projectPath) ||
			hasWorkspaceField(path.join(projectPath, "package.json"))
	);
}

function getMonorepoType(projectPath: string): "npm" | "pnpm" | "unknown" {
	if (getWorkspaceYamlPath(projectPath)) {
		return "pnpm";
	}
	if (hasWorkspaceField(path.join(projectPath, "package.json"))) {
		return "npm";
	}
	return "unknown";
}

function getPackageList(projectPath: string): string[] {
	const monorepoType = getMonorepoType(projectPath);
	if (monorepoType === "npm") {
		const packageJson = readJsonFile(path.join(projectPath, "package.json"));
		if (Array.isArray(packageJson["workspaces"])) {
			return packageJson["workspaces"];
		}
		if (Array.isArray(packageJson["workspaces"]?.packages)) {
			return packageJson["workspaces"].packages;
		}
		return [];
	}
	if (monorepoType === "pnpm") {
		const workspaceYamlPath = getWorkspaceYamlPath(projectPath);
		if (!workspaceYamlPath) return [];
		const workspaceYaml = yaml.load(fs.readFileSync(workspaceYamlPath, "utf-8")) as {
			packages?: string[];
		};
		return Array.isArray(workspaceYaml?.packages) ? workspaceYaml.packages : [];
	}
	return [];
}

function normalizePackageSpecifier(specifier: string): string {
	if (specifier.startsWith("@")) {
		const parts = specifier.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
	}
	return specifier.split("/")[0] || specifier;
}

function getDeclaredDependencies(manifest: Record<string, any>): string[] {
	return Array.from(
		new Set([
			...Object.keys(manifest["dependencies"] || {}),
			...Object.keys(manifest["peerDependencies"] || {}),
			...Object.keys(manifest["optionalDependencies"] || {}),
			...Object.keys(manifest["devDependencies"] || {}),
		])
	).sort((a, b) => a.localeCompare(b));
}

async function getUsedImports(args: AnalyzeArgs): Promise<string[]> {
	const fileContentList = await scan(args);
	const astList = await parseAST(fileContentList as string[]);
	const imports = new Set<string>();

	for (const ast of astList) {
		traverse(ast, {
			ImportDeclaration(importPath: any) {
				const sourceValue = importPath.node?.source?.value;
				if (typeof sourceValue === "string" && !sourceValue.startsWith(".")) {
					imports.add(normalizePackageSpecifier(sourceValue));
				}
			},
			CallExpression(callPath: any) {
				const { node } = callPath;
				if (
					node.callee?.type === "Identifier" &&
					node.callee.name === "require" &&
					node.arguments.length === 1 &&
					node.arguments[0]?.type === "StringLiteral"
				) {
					const sourceValue = node.arguments[0].value;
					if (typeof sourceValue === "string" && !sourceValue.startsWith(".")) {
						imports.add(normalizePackageSpecifier(sourceValue));
					}
				}
				if (
					node.callee?.type === "Import" &&
					node.arguments.length === 1 &&
					node.arguments[0]?.type === "StringLiteral"
				) {
					const sourceValue = node.arguments[0].value;
					if (typeof sourceValue === "string" && !sourceValue.startsWith(".")) {
						imports.add(normalizePackageSpecifier(sourceValue));
					}
				}
			},
		});
	}

	return Array.from(imports)
		.filter((item) => item !== "" && !item.startsWith("node:"))
		.sort((a, b) => a.localeCompare(b));
}

async function getWorkspacePackages(projectPath: string): Promise<WorkspacePackage[]> {
	const patterns = getPackageList(projectPath);
	if (patterns.length === 0) return [];

	const manifestPatterns = patterns.map((pattern) => {
		const cleanPattern = pattern.replace(/[\\/]+$/, "");
		return cleanPattern.endsWith("package.json")
			? cleanPattern
			: `${cleanPattern}/package.json`;
	});

	const manifestPaths = await glob(manifestPatterns, {
		cwd: projectPath,
		onlyFiles: true,
		unique: true,
		ignore: ["**/node_modules/**"],
	});

	const packages: WorkspacePackage[] = [];
	for (const relativeManifestPath of manifestPaths.sort((a, b) => a.localeCompare(b))) {
		const manifestPath = path.join(projectPath, relativeManifestPath);
		const manifest = readJsonFile(manifestPath);
		if (typeof manifest["name"] !== "string" || manifest["name"].trim() === "") {
			continue;
		}
		const dir = path.dirname(manifestPath);
		packages.push({
			name: manifest["name"],
			dir,
			relativeDir: path.relative(projectPath, dir) || ".",
			manifestPath,
			manifest,
		});
	}

	return packages;
}

function buildFallbackSummary(
	declaredDependencies: string[],
	usedImports: string[]
): Result {
	const usedSet = new Set(usedImports);
	const unusedDependencies = declaredDependencies
		.filter((dependency) => !usedSet.has(dependency))
		.map((dependency) => ({
			name: dependency,
			type: "",
			version: {},
			usage: false,
			isDev: false,
		}));

	return {
		usedDependencies: usedImports.length,
		unusedDependencies,
		ununsedDependenciesCount: unusedDependencies.length,
		totalDependencies: declaredDependencies.length,
		devDependencies: [],
	};
}

function getDisplayableUnusedDependencies(summary: Result | null): string[] {
	if (!summary) return [];
	return summary.unusedDependencies
		.filter((dependency) => dependency.type !== "dynamic")
		.map((dependency) => dependency.name)
		.filter((dependencyName): dependencyName is string => {
			return dependencyName !== "" && dependencyName !== "undefined";
		});
}

function getDynamicUnusedDependencies(summary: Result | null) {
	if (!summary) return [];
	return summary.unusedDependencies.filter((dependency) => dependency.type === "dynamic");
}

function displayMonorepoResults(
	projectPath: string,
	monorepoType: string,
	reports: MonorepoPackageReport[]
) {
	const reportsWithUnusedDeps = reports.filter(
		(report) => (report.summary?.ununsedDependenciesCount || 0) > 0
	);
	const reportsWithoutUnusedDeps = reports.filter(
		(report) => (report.summary?.ununsedDependenciesCount || 0) === 0
	);
	const reportsWithGhostDeps = reports.filter((report) => report.ghostDependencies.length > 0);
	const compactPackageNames = reportsWithoutUnusedDeps.map((report) => report.pkg.name).sort();

	console.log("\n" + chalk.bold.green("Monorepo Check Results:"));
	console.log(chalk.gray("-".repeat(50)));
	logSuccess(` Monorepo type: ${monorepoType}`);
	logSuccess(` Workspace packages analyzed: ${reports.length}`);
	logInfo(` Project root: ${projectPath}`);
	logInfo(` Packages with unused dependencies: ${reportsWithUnusedDeps.length}`);
	logInfo(` Packages with ghost dependencies: ${reportsWithGhostDeps.length}`);
	logInfo(` Packages without unused dependencies: ${reportsWithoutUnusedDeps.length}`);

	if (compactPackageNames.length > 0) {
		console.log("\n" + chalk.bold.green("Packages Without Unused Dependencies:"));
		console.log(chalk.gray("-".repeat(50)));
		for (const chunk of chunkItems(compactPackageNames, 6)) {
			logSecondary(`\t- ${chunk.join(", ")}`);
		}
	}

	if (reportsWithUnusedDeps.length === 0) {
		logSuccess(` No workspace package contains unused dependencies`);
		return;
	}

	console.log("\n" + chalk.bold.green("Packages With Unused Dependencies:"));
	console.log(chalk.gray("-".repeat(50)));

	for (const report of reportsWithUnusedDeps) {
		const { pkg, summary } = report;
		const displayableUnusedDependencies = getDisplayableUnusedDependencies(summary);
		const dynamicUnusedDependencies = getDynamicUnusedDependencies(summary);
		console.log(
			"\n" + chalk.bold.cyan(`${pkg.name}  (${pkg.relativeDir.replace(/\\/g, "/")})`)
		);
		console.log(chalk.gray("-".repeat(50)));

		logInfo(` Declared dependencies: ${report.declaredDependencies.length}`);
		logInfo(` Referenced external packages: ${report.usedImports.length}`);

		logWarning(` Unused dependencies: ${displayableUnusedDependencies.length}`);
		displayableUnusedDependencies.forEach((dependencyName) => {
			logSecondary(`\t- ${dependencyName}`);
		});

		if (dynamicUnusedDependencies.length > 0) {
			logInfo(
				` Dynamic imports skipped: ${dynamicUnusedDependencies.length}`
			);
		}

		if (report.workspaceDependencies.length > 0) {
			logInfo(` Workspace references: ${report.workspaceDependencies.length}`);
			report.workspaceDependencies.forEach((dependency) => {
				const declared = report.declaredDependencies.includes(dependency);
				logSecondary(`\t- ${dependency}${declared ? "" : " (undeclared)"}`);
			});
		}

		if (report.ghostDependencies.length > 0) {
			logWarning(` Ghost dependencies: ${report.ghostDependencies.length}`);
			report.ghostDependencies.forEach((dependency) => {
				logSecondary(`\t- ${dependency}`);
			});
		}
	}
}

async function monorepoMode(
	args: AnalyzeArgs,
	analyzeProject: AnalyzeProjectFn
): Promise<[] | MonorepoAnalysisReport> {
	const monorepoType = getMonorepoType(args.path);
	const packageList = await getWorkspacePackages(args.path);

	if (packageList.length === 0) {
		logWarning(` No workspace packages were found under ${args.path}`);
		const emptyResult: [] = [];
		return emptyResult;
	}

	const workspaceNames = new Set(packageList.map((pkg) => pkg.name));
	const reports: MonorepoPackageReport[] = [];
	let bar: cliProgress.SingleBar | null = null;

	if (!args.silence) {
		bar = new cliProgress.SingleBar(
			{
				clearOnComplete: true,
				hideCursor: true,
				format: " {bar} | {stepname} | {value}/{total}",
			},
			cliProgress.Presets.shades_classic
		);
		bar.start(packageList.length, 0, { stepname: "Analyzing workspace packages" });
	}

	for (const pkg of packageList) {
		if (bar) {
			bar.update(reports.length, {
				stepname: `Analyzing ${pkg.name}`,
			});
		}

		const packageArgs = {
			...args,
			path: pkg.dir,
			silence: true,
		} as AnalyzeArgs;

		let summary: Result | null = null;
		try {
			const result = await analyzeProject(packageArgs, false);
			if (Array.isArray(result) && result.length > 0) {
				summary = result[0] as Result;
			}
		} catch (error) {
			logWarning(
				` Falling back to source-only analysis for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		const usedImports = await getUsedImports(packageArgs);
		const declaredDependencies = getDeclaredDependencies(pkg.manifest);
		const workspaceDependencies = usedImports.filter(
			(dependency) => dependency !== pkg.name && workspaceNames.has(dependency)
		);
		const declaredSet = new Set(declaredDependencies);
		const undeclaredWorkspaceDependencies = workspaceDependencies.filter(
			(dependency) => !declaredSet.has(dependency)
		);
		const ghostDependencies = usedImports.filter(
			(dependency) => !workspaceNames.has(dependency) && !declaredSet.has(dependency)
		);

		reports.push({
			pkg,
			summary: summary || buildFallbackSummary(declaredDependencies, usedImports),
			usedImports,
			declaredDependencies,
			workspaceDependencies,
			undeclaredWorkspaceDependencies,
			ghostDependencies,
		});

		if (bar) {
			bar.increment({
				stepname: `Analyzed ${pkg.name}`,
			});
		}
	}

	if (bar) {
		bar.stop();
	}

	const jsonReport: MonorepoAnalysisReport = {
		kind: "monorepo",
		projectPath: args.path,
		monorepoType,
		packageCount: reports.length,
		packagesWithUnusedDependencies: reports.filter(
			(report) => (report.summary?.ununsedDependenciesCount || 0) > 0
		).length,
		packagesWithGhostDependencies: reports.filter(
			(report) => report.ghostDependencies.length > 0
		).length,
		packagesWithoutUnusedDependencies: reports.filter(
			(report) => (report.summary?.ununsedDependenciesCount || 0) === 0
		).length,
		packages: reports.map((report) => ({
			name: report.pkg.name,
			path: report.pkg.relativeDir.replace(/\\/g, "/"),
			summary: report.summary,
			usedImports: report.usedImports,
			declaredDependencies: report.declaredDependencies,
			workspaceDependencies: report.workspaceDependencies,
			undeclaredWorkspaceDependencies: report.undeclaredWorkspaceDependencies,
			ghostDependencies: report.ghostDependencies,
			dynamicUnusedDependencies: getDynamicUnusedDependencies(report.summary).map(
				(dependency) => dependency.args || dependency.name
			),
		})),
	};

	if (args.json) {
		return jsonReport;
	}

	displayMonorepoResults(args.path, monorepoType, reports);
	const emptyResult: [] = [];
	return emptyResult;
}

export { isMonorepo, monorepoMode };
