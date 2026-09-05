import fs from "fs";
import path from "path";
import glob from "fast-glob";
import yaml from "js-yaml";
import { ArgumentsCamelCase } from "yargs";
import cliProgress from "cli-progress";
import {
	AnalysisCliArgs,
	MonorepoAnalysisReport,
	MonorepoPackageAnalysisReport,
	PackageEvidenceChain,
	Result,
	ScanError,
} from "../types";
import { logWarning } from "../utils/cli-utils";
import {
	buildMonorepoAnalysisReport,
	buildMonorepoPackageAnalysisReport,
	createEmptyMonorepoEvidenceIndex,
} from "../report/builders";
import { buildMonorepoEvidenceIndex } from "../evidence";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

/**
 * 由 analyzer 注入的单包分析函数。
 * 用参数传入而不是直接 import，是为了避免 analyzer <-> monorepo 的模块循环。
 */
export type AnalyzePackageFn = (input: {
	args: AnalyzeArgs;
	collectEvidence: boolean;
	packageName?: string;
	manifest?: Record<string, any>;
	manifestPath?: string;
	workspaceNames?: Set<string>;
}) => Promise<PackageAnalysisResult>;

export interface PackageAnalysisResult {
	summary: Result;
	evidence: PackageEvidenceChain;
	referencedDependencies: string[];
	declaredDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	scanErrors: ScanError[];
}

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
		return JSON.parse(stripBom(fs.readFileSync(filePath, "utf-8"))) as Record<string, any>;
	} catch (error) {
		throw new Error(
			`Failed to parse JSON file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function getWorkspaceYamlPath(projectPath: string): string | null {
	for (const candidate of ["pnpm-workspace.yaml", "pnpm-monorepo.yaml"]) {
		const fullPath = path.join(projectPath, candidate);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}
	return null;
}

function hasWorkspaceField(packageJsonPath: string): boolean {
	if (!fs.existsSync(packageJsonPath)) return false;
	return Boolean(readJsonFile(packageJsonPath)["workspaces"]);
}

function isMonorepo(projectPath: string): boolean {
	return Boolean(
		getWorkspaceYamlPath(projectPath) ||
			hasWorkspaceField(path.join(projectPath, "package.json"))
	);
}

function getMonorepoType(projectPath: string): "npm" | "pnpm" | "unknown" {
	if (getWorkspaceYamlPath(projectPath)) return "pnpm";
	if (hasWorkspaceField(path.join(projectPath, "package.json"))) return "npm";
	return "unknown";
}

function getPackageList(projectPath: string): string[] {
	const monorepoType = getMonorepoType(projectPath);

	if (monorepoType === "npm") {
		const packageJson = readJsonFile(path.join(projectPath, "package.json"));
		const workspaces = packageJson["workspaces"];
		if (Array.isArray(workspaces)) return workspaces;
		if (Array.isArray(workspaces?.packages)) return workspaces.packages;
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

async function getWorkspacePackages(projectPath: string): Promise<WorkspacePackage[]> {
	const patterns = getPackageList(projectPath);
	const rootManifestPath = path.join(projectPath, "package.json");
	const packages: WorkspacePackage[] = [];
	if (fs.existsSync(rootManifestPath)) {
		const rootManifest = readJsonFile(rootManifestPath);
		const rootHasWork = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "scripts"]
			.some((section) => rootManifest[section] && typeof rootManifest[section] === "object");
		if (rootHasWork && typeof rootManifest["name"] === "string" && rootManifest["name"].trim() !== "") {
			packages.push({
				name: rootManifest["name"],
				dir: projectPath,
				relativeDir: ".",
				manifestPath: rootManifestPath,
				manifest: rootManifest,
			});
		}
	}
	if (patterns.length === 0) return packages;

	const manifestPatterns = patterns.map((pattern) => {
		const cleanPattern = pattern.replace(/[\\/]+$/, "");
		return cleanPattern.endsWith("package.json") ? cleanPattern : `${cleanPattern}/package.json`;
	});

	const manifestPaths = await glob(manifestPatterns, {
		cwd: projectPath,
		onlyFiles: true,
		unique: true,
		ignore: ["**/node_modules/**"],
	});

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

async function monorepoMode(
	args: AnalyzeArgs,
	analyzePackage: AnalyzePackageFn,
	collectEvidence: boolean = true
): Promise<MonorepoAnalysisReport> {
	const monorepoType = getMonorepoType(args.path);
	const packageList = await getWorkspacePackages(args.path);

	if (packageList.length === 0) {
		logWarning(` No workspace packages were found under ${args.path}`);
		return buildMonorepoAnalysisReport(
			args.path,
			monorepoType,
			[],
			createEmptyMonorepoEvidenceIndex()
		);
	}

	const workspaceNames = new Set(packageList.map((pkg) => pkg.name));
	const rootConfigPath = path.join(args.path, "deplens.config.json");
	const packages: MonorepoPackageAnalysisReport[] = [];
	const scanErrors: ScanError[] = [];
	let bar: import("cli-progress").SingleBar | null = null;

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
		bar?.update(packages.length, { stepname: `Analyzing ${pkg.name}` });

		const isRootPackage = pkg.relativeDir === ".";
		const workspaceDirs = packageList
			.filter((item) => item.relativeDir !== ".")
			.map((item) => item.relativeDir);
		const inheritedIgnorePath = workspaceDirs.join(",");
		const packageArgs = {
			...args,
			path: pkg.dir,
			silence: true,
			config: args.config || (fs.existsSync(rootConfigPath) ? rootConfigPath : ""),
			...(isRootPackage && inheritedIgnorePath
				? { ignorePath: [args.ignorePath, inheritedIgnorePath].filter(Boolean).join(",") }
				: {}),
		} as AnalyzeArgs;
		const analysis = await analyzePackage({
			args: packageArgs,
			collectEvidence,
			packageName: pkg.name,
			manifest: pkg.manifest,
			manifestPath: pkg.manifestPath,
			workspaceNames,
		});

		scanErrors.push(...analysis.scanErrors);

		if (!analysis.summary.lockfile.resolved && !args.silence) {
			logWarning(
				` Lockfile data is unavailable for ${pkg.name}, removal risk cannot be graded: ${analysis.summary.lockfile.reason}`
			);
		}

		packages.push(
			buildMonorepoPackageAnalysisReport({
				name: pkg.name,
				path: pkg.relativeDir.replace(/\\/g, "/"),
				summary: analysis.summary,
				usedImports: analysis.referencedDependencies,
				declaredDependencies: analysis.declaredDependencies,
				workspaceDependencies: analysis.workspaceDependencies,
				undeclaredWorkspaceDependencies: analysis.undeclaredWorkspaceDependencies,
				ghostDependencies: analysis.ghostDependencies,
				evidence: analysis.evidence,
			})
		);

		bar?.increment({ stepname: `Analyzed ${pkg.name}` });
	}

	bar?.stop();

	if (scanErrors.length > 0 && !args.silence) {
		if (args.verbose) {
			for (const error of scanErrors) {
				logWarning(` Failed to read or parse ${error.path}: ${error.message}`);
			}
		} else {
			logWarning(
				` ${scanErrors.length} file(s) could not be read or parsed and were skipped. Run with --verbose for details.`
			);
		}
	}

	return buildMonorepoAnalysisReport(
		args.path,
		monorepoType,
		packages,
		collectEvidence
			? buildMonorepoEvidenceIndex(packages)
			: createEmptyMonorepoEvidenceIndex(packages.map((pkg) => pkg.name))
	);
}

export { isMonorepo, monorepoMode };
