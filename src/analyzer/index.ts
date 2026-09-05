import path from "path";
import { ArgumentsCamelCase } from "yargs";
import {
	AnalysisCliArgs,
	AnalysisReport,
	DeclaredDependency,
	LockfileGraph,
	PackageEvidenceChain,
	ParsedSourceBlock,
	ReferenceEvidence,
	Result,
	ScanError,
} from "../types";
import { scanProjectSources } from "./scanner";
import { parseSources } from "./parser";
import { collectReferences } from "./references";
import { createExternalSpecifierFilter } from "./specifier";
import { buildAnalysisSummary, collectScriptReferencedDependencies } from "./dependency";
import { buildLockfileGraph } from "../driver/lockfile-graph";
import { isMonorepo, monorepoMode } from "../driver/monorepo";
import { resolveIgnoreRules } from "../config/ignore";
import { logInfo, logWarning } from "../utils/cli-utils";
import cliProgress from "cli-progress";
import {
	buildProjectAnalysisReport,
	createEmptyPackageEvidenceChain,
} from "../report/builders";
import { outputJsonReport } from "../report/output";
import { renderAnalysisReport, renderProjectResult } from "../report/renderers";
import { buildPackageEvidenceChain, readManifest, resolvePackageName } from "../evidence";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

export interface PackageAnalysisInput {
	args: AnalyzeArgs;
	collectEvidence: boolean;
	packageName?: string;
	manifest?: Record<string, any>;
	manifestPath?: string;
	workspaceNames?: Set<string>;
}

export interface PackageAnalysisOutput {
	packageName: string;
	summary: Result;
	evidence: PackageEvidenceChain;
	references: ReferenceEvidence[];
	referencedDependencies: string[];
	declaredDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	scanErrors: ScanError[];
}

const DECLARED_SECTIONS = [
	"dependencies",
	"peerDependencies",
	"optionalDependencies",
	"devDependencies",
] as const;

/**
 * lockfile 不可用时的兜底关系图：只有声明，没有 requiredBy 关系。
 * 结果里会明确标注 lockfile 未解析，避免把「无法判断风险」当成「零风险」。
 */
function buildManifestOnlyGraph(manifest: Record<string, any>): LockfileGraph {
	const declared: DeclaredDependency[] = [];
	const seen = new Set<string>();

	for (const section of DECLARED_SECTIONS) {
		const bucket = manifest[section];
		if (!bucket || typeof bucket !== "object") continue;
		for (const [name, range] of Object.entries(bucket as Record<string, unknown>)) {
			if (seen.has(name)) continue;
			seen.add(name);
			declared.push({
				name,
				section,
				range: typeof range === "string" ? range : "",
				requiredBy: [],
			});
		}
	}

	return {
		manager: "npm",
		lockfilePath: "",
		importerKey: ".",
		declared: declared.sort((a, b) => a.name.localeCompare(b.name)),
		transitiveEdgeCount: 0,
	};
}

function resolveGraph(projectPath: string, manifest: Record<string, any>): {
	graph: LockfileGraph;
	lockfile: Result["lockfile"];
} {
	try {
		const lockfileGraph = buildLockfileGraph(projectPath);
		// package.json 是当前声明的事实来源；lockfile 只补充依赖关系和版本风险。
		const manifestGraph = buildManifestOnlyGraph(manifest);
		const graph: LockfileGraph = {
			...lockfileGraph,
			declared: manifestGraph.declared.map((declared) => ({
				...declared,
				requiredBy: lockfileGraph.declared.find((item) => item.name === declared.name)?.requiredBy || [],
			})),
		};
		return {
			graph,
			lockfile: { resolved: true, manager: graph.manager, path: graph.lockfilePath },
		};
	} catch (error) {
		return {
			graph: buildManifestOnlyGraph(manifest),
			lockfile: {
				resolved: false,
				reason: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

/**
 * 单个包的完整分析：扫描 -> 解析 -> 引用收集 -> lockfile 关系 -> 汇总 -> 证据链。
 * 全流程只扫描一次源码，分析结论与证据链共用同一份引用数据。
 */
export async function analyzePackage(input: PackageAnalysisInput): Promise<PackageAnalysisOutput> {
	const { args } = input;
	const manifest = input.manifest || readManifest(args.path);
	const packageName = resolvePackageName(args.path, manifest, input.packageName);
	const manifestAbsolutePath = input.manifestPath || path.join(args.path, "package.json");
	const manifestPath = path.relative(args.path, manifestAbsolutePath).replace(/\\/g, "/") || "package.json";
	const workspaceNames = input.workspaceNames || new Set<string>();

	const scan = await scanProjectSources(args);
	const parsed = parseSources(scan.files);
	const blocks: ParsedSourceBlock[] = parsed.blocks;
	const scanErrors = [...scan.errors, ...parsed.errors];

	const filter = createExternalSpecifierFilter(args.path);
	const { references, dynamicSpecifiers } = collectReferences({
		packageName,
		blocks,
		filter,
		workspaceNames,
	});

	const { graph, lockfile } = resolveGraph(args.path, manifest);
	const ignoreRules = resolveIgnoreRules(args);
	const summary: Result = {
		...buildAnalysisSummary({
			graph,
			references,
			dynamicSpecifiers,
			ignoredDependencies: ignoreRules.dependencies,
			lockfileResolved: lockfile.resolved,
			scriptReferenced: collectScriptReferencedDependencies(
				manifest,
				graph.declared.map((item) => item.name)
			),
		}),
		lockfile,
		...(scanErrors.length > 0 ? { scanErrors } : {}),
	};

	const declaredNames = new Set(graph.declared.map((item) => item.name));
	const referencedDependencies = Array.from(
		new Set(references.map((item) => item.dependencyName))
	).sort((a, b) => a.localeCompare(b));
	const workspaceDependencies = referencedDependencies.filter(
		(name) => name !== packageName && workspaceNames.has(name)
	);
	const undeclaredWorkspaceDependencies = workspaceDependencies.filter(
		(name) => !declaredNames.has(name)
	);
	const ignoredDeps = new Set(ignoreRules.dependencies);
	const ghostDependencies = referencedDependencies.filter(
		(name) => !workspaceNames.has(name) && !declaredNames.has(name) && !ignoredDeps.has(name)
	);

	const evidence = input.collectEvidence
		? buildPackageEvidenceChain({
			projectPath: args.path,
			packageName,
			manifest,
			manifestPath,
			manifestAbsolutePath,
			blocks,
			references,
			summary,
			ghostDependencies,
			undeclaredWorkspaceDependencies,
			workspaceNames: Array.from(workspaceNames),
		})
		: createEmptyPackageEvidenceChain();

	return {
		packageName,
		summary,
		evidence,
		references,
		referencedDependencies,
		declaredDependencies: Array.from(declaredNames).sort((a, b) => a.localeCompare(b)),
		workspaceDependencies,
		undeclaredWorkspaceDependencies,
		ghostDependencies,
		scanErrors,
	};
}

function reportScanErrors(args: AnalyzeArgs, errors: ScanError[]): void {
	if (errors.length === 0 || args.silence) return;

	if (args.verbose) {
		for (const error of errors) {
			logWarning(` Failed to read or parse ${error.path}: ${error.message}`);
		}
		return;
	}

	logWarning(
		` ${errors.length} file(s) could not be read or parsed and were skipped. Run with --verbose for details.`
	);
}

export async function analyzeProject(
	args: AnalyzeArgs,
	showResult: boolean = true,
	collectEvidence: boolean = true
): Promise<[] | AnalysisReport> {
	if (isMonorepo(args.path)) {
		if (!args.silence) {
			logInfo(` Monorepo detected, transiting to monorepo mode`);
		}
		const monorepoReport = await monorepoMode(args, analyzePackage, collectEvidence);
		if (showResult) {
			if (args.json) {
				outputJsonReport(monorepoReport, args);
				return monorepoReport;
			}
			renderAnalysisReport(monorepoReport, args);
			return [];
		}
		return monorepoReport;
	}

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
		bar.start(2, 0, { stepname: "Scanning sources" });
	}

	const analysis = await analyzePackage({ args, collectEvidence });
	bar?.increment({ stepname: "Resolving dependencies" });
	const report = buildProjectAnalysisReport(args.path, analysis.summary, analysis.evidence);
	bar?.increment({ stepname: "Building report" });
	bar?.stop();

	reportScanErrors(args, analysis.scanErrors);

	if (showResult) {
		if (args.json) {
			outputJsonReport(report, args);
			return report;
		}

		renderAnalysisReport(report, args);
		return [];
	}

	return report;
}

export function displayResults(result: Result, options: AnalyzeArgs): void {
	renderProjectResult(result, options);
}
