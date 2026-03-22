import fs from "fs";
import path from "path";
import glob from "fast-glob";
import yaml from "js-yaml";
import traverse from "@babel/traverse";
import { ArgumentsCamelCase } from "yargs";
import cliProgress from "cli-progress";
import { parseAST } from "../analyzer/parser";
import { scan } from "../analyzer/scanner";
import {
	AnalysisCliArgs,
	MonorepoAnalysisReport,
	MonorepoPackageAnalysisReport,
	Result,
} from "../types";
import { logWarning } from "../utils/cli-utils";
import {
	buildMonorepoAnalysisReport,
	buildMonorepoPackageAnalysisReport,
} from "../report/builders";
import { buildMonorepoEvidenceIndex, buildPackageEvidenceChain } from "../evidence";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;
type AnalyzeProjectFn = (args: AnalyzeArgs) => Promise<Result>;

interface WorkspacePackage {
	name: string;
	dir: string;
	relativeDir: string;
	manifestPath: string;
	manifest: Record<string, any>;
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

async function monorepoMode(
	args: AnalyzeArgs,
	analyzeProject: AnalyzeProjectFn
): Promise<MonorepoAnalysisReport> {
	const monorepoType = getMonorepoType(args.path);
	const packageList = await getWorkspacePackages(args.path);

	if (packageList.length === 0) {
		logWarning(` No workspace packages were found under ${args.path}`);
		return buildMonorepoAnalysisReport(
			args.path,
			monorepoType,
			[],
			buildMonorepoEvidenceIndex([])
		);
	}

	const workspaceNames = new Set(packageList.map((pkg) => pkg.name));
	const packages: MonorepoPackageAnalysisReport[] = [];
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
			bar.update(packages.length, {
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
			summary = await analyzeProject(packageArgs);
		} catch (error) {
			logWarning(
				` Falling back to source-only analysis for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		let usedImports: string[] = [];
		try {
			usedImports = await getUsedImports(packageArgs);
		} catch (error) {
			logWarning(
				` Falling back to empty import graph for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
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
		const normalizedSummary = summary || buildFallbackSummary(declaredDependencies, usedImports);
		const evidence = await buildPackageEvidenceChain({
			args: packageArgs,
			packageName: pkg.name,
			manifest: pkg.manifest,
			manifestPath: pkg.manifestPath,
			summary: normalizedSummary,
			ghostDependencies,
			undeclaredWorkspaceDependencies,
			workspaceNames: Array.from(workspaceNames),
		});

		packages.push(
			buildMonorepoPackageAnalysisReport({
				name: pkg.name,
				path: pkg.relativeDir.replace(/\\/g, "/"),
				summary: normalizedSummary,
				usedImports,
				declaredDependencies,
				workspaceDependencies,
				undeclaredWorkspaceDependencies,
				ghostDependencies,
				evidence,
			})
		);

		if (bar) {
			bar.increment({
				stepname: `Analyzed ${pkg.name}`,
			});
		}
	}

	if (bar) {
		bar.stop();
	}

	return buildMonorepoAnalysisReport(
		args.path,
		monorepoType,
		packages,
		buildMonorepoEvidenceIndex(packages)
	);
}

export { isMonorepo, monorepoMode };
