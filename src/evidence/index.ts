import fs from "fs";
import path from "path";
import traverse from "@babel/traverse";
import {
	DeclarationEvidence,
	IssueEvidence,
	ManifestSection,
	MonorepoEvidenceIndex,
	MonorepoPackageAnalysisReport,
	PackageEvidenceChain,
	ParsedSourceBlock,
	ReferenceEvidence,
	Result,
	SignalEvidence,
	UnusedDependencyClass,
} from "../types";
import { isBuiltInModule, normalizePackageSpecifier } from "../analyzer/specifier";

export interface BuildPackageEvidenceInput {
	projectPath: string;
	packageName: string;
	manifest: Record<string, any>;
	manifestPath: string;
	manifestAbsolutePath: string;
	blocks: ParsedSourceBlock[];
	references: ReferenceEvidence[];
	summary: Result | null;
	ghostDependencies?: string[];
	undeclaredWorkspaceDependencies?: string[];
	workspaceNames?: string[];
}

const MANIFEST_SECTIONS: ManifestSection[] = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

function collectDeclarationEvidence(
	packageName: string,
	manifest: Record<string, any>,
	manifestPath: string
): DeclarationEvidence[] {
	const declarations: DeclarationEvidence[] = [];

	for (const section of MANIFEST_SECTIONS) {
		const dependencyMap = manifest[section];
		if (!dependencyMap || typeof dependencyMap !== "object") continue;

		for (const [dependencyName, versionRange] of Object.entries(dependencyMap)) {
			declarations.push({
				id: `${packageName}:decl:${section}:${dependencyName}`,
				packageName,
				dependencyName,
				manifestPath,
				section,
				versionRange: String(versionRange),
			});
		}
	}

	return declarations.sort((a, b) => a.dependencyName.localeCompare(b.dependencyName));
}

function createSignalEvidence(
	packageName: string,
	dependencyName: string,
	filePath: string,
	line: number,
	column: number,
	signalType: SignalEvidence["signalType"],
	fileRole: SignalEvidence["fileRole"],
	value: string
): SignalEvidence {
	return {
		id: `${packageName}:signal:${signalType}:${filePath}:${line}:${column}:${dependencyName}`,
		packageName,
		dependencyName,
		filePath,
		line,
		column,
		signalType,
		fileRole,
		value,
	};
}

function looksLikePackageSpecifier(value: string): boolean {
	if (
		value.startsWith(".")
		|| value.startsWith("/")
		|| value.startsWith("node:")
		|| value.includes("\\")
		|| value.includes(":")
	) {
		return false;
	}
	return /^[a-zA-Z0-9@][a-zA-Z0-9@._/-]*$/.test(value);
}

export function resolveFileRole(filePath: string): SignalEvidence["fileRole"] {
	const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
	if (
		normalizedPath.includes("/test/")
		|| normalizedPath.includes("/tests/")
		|| normalizedPath.includes("/__tests__/")
		|| normalizedPath.endsWith(".test.ts")
		|| normalizedPath.endsWith(".test.tsx")
		|| normalizedPath.endsWith(".spec.ts")
		|| normalizedPath.endsWith(".spec.tsx")
	) {
		return "test";
	}
	if (
		normalizedPath.includes("/scripts/")
		|| normalizedPath.endsWith("/package.json")
		|| normalizedPath === "package.json"
	) {
		return "script";
	}
	if (
		normalizedPath.includes("/tooling/")
		|| normalizedPath.includes("/build/")
		|| normalizedPath.includes("/bundler/")
		|| normalizedPath.includes("/compiler/")
		|| normalizedPath.includes("/loader/")
		|| normalizedPath.includes("/loaders/")
		|| normalizedPath.includes("/plugin/")
		|| normalizedPath.includes("/plugins/")
		|| normalizedPath.includes("/preset/")
		|| normalizedPath.includes("/presets/")
		|| normalizedPath.includes("transpiler")
		|| normalizedPath.includes("minifier")
		|| normalizedPath.includes("compiler")
		|| normalizedPath.includes("bundler")
		|| normalizedPath.includes("loader")
		|| normalizedPath.includes("plugin")
		|| normalizedPath.includes("preset")
	) {
		return "tooling";
	}
	if (
		normalizedPath.includes("config")
		|| normalizedPath.endsWith(".config.js")
		|| normalizedPath.endsWith(".config.ts")
		|| normalizedPath.endsWith(".config.cjs")
		|| normalizedPath.endsWith(".config.mjs")
	) {
		return "config";
	}
	return "source";
}

function getNodeKeyName(node: any): string | undefined {
	if (!node) return undefined;
	if (node.type === "Identifier") return node.name;
	if (node.type === "StringLiteral") return node.value;
	return undefined;
}

function getCalleeName(callee: any): string | undefined {
	if (!callee) return undefined;
	if (callee.type === "Identifier") return callee.name;
	if (callee.type === "MemberExpression") {
		return getNodeKeyName(callee.property);
	}
	return undefined;
}

function hasToolingHintInAncestors(stringPath: any): boolean {
	const toolingPattern = /(plugin|plugins|preset|presets|loader|loaders|transform|transpile|compile|compiler|babel|parser|resolve|alias)/i;
	let current = stringPath.parentPath;

	while (current) {
		const node = current.node;
		if (node?.type === "ObjectProperty" || node?.type === "ObjectMethod") {
			const keyName = getNodeKeyName(node.key);
			if (keyName && toolingPattern.test(keyName)) {
				return true;
			}
		}

		if (node?.type === "CallExpression") {
			const calleeName = getCalleeName(node.callee);
			if (calleeName && toolingPattern.test(calleeName)) {
				return true;
			}
		}

		current = current.parentPath;
	}

	return false;
}

function collectSignalEvidence(
	packageName: string,
	blocks: ParsedSourceBlock[],
	candidateDependencies: Set<string>
): SignalEvidence[] {
	const signals: SignalEvidence[] = [];
	const seen = new Set<string>();

	const push = (signal: SignalEvidence) => {
		if (seen.has(signal.id)) return;
		seen.add(signal.id);
		signals.push(signal);
	};

	for (const block of blocks) {
		const fileRole = resolveFileRole(block.file.path);

		traverse(block.ast, {
			StringLiteral(stringPath: any) {
				const rawValue = stringPath.node?.value;
				if (typeof rawValue !== "string" || !looksLikePackageSpecifier(rawValue)) return;

				const dependencyName = normalizePackageSpecifier(rawValue);
				if (!candidateDependencies.has(dependencyName) || isBuiltInModule(dependencyName)) return;

				const parent = stringPath.parentPath?.node;
				if (parent?.type === "ImportDeclaration") return;
				if (
					parent?.type === "CallExpression"
					&& (parent.callee?.type === "Import"
						|| (parent.callee?.type === "Identifier" && parent.callee.name === "require"))
				) {
					return;
				}

				push(createSignalEvidence(
					packageName,
					dependencyName,
					block.file.path,
					(stringPath.node?.loc?.start?.line ?? 1) + block.lineOffset,
					(stringPath.node?.loc?.start?.column ?? 0) + 1,
					hasToolingHintInAncestors(stringPath) ? "tooling-string" : "string-literal",
					fileRole,
					rawValue
				));
			},

			CallExpression(callPath: any) {
				const node = callPath.node;
				const args = Array.isArray(node?.arguments) ? node.arguments : [];
				const argument = args[0];
				if (args.length !== 1 || argument?.type !== "StringLiteral") return;

				const rawValue = argument.value;
				if (typeof rawValue !== "string" || !looksLikePackageSpecifier(rawValue)) return;

				const dependencyName = normalizePackageSpecifier(rawValue);
				if (!candidateDependencies.has(dependencyName) || isBuiltInModule(dependencyName)) return;

				const isRequireResolve =
					node.callee?.type === "MemberExpression"
					&& node.callee.object?.type === "Identifier"
					&& node.callee.object.name === "require"
					&& node.callee.property?.type === "Identifier"
					&& node.callee.property.name === "resolve";

				if (!isRequireResolve) return;

				push(createSignalEvidence(
					packageName,
					dependencyName,
					block.file.path,
					(argument.loc?.start?.line ?? 1) + block.lineOffset,
					(argument.loc?.start?.column ?? 0) + 1,
					"require-resolve",
					fileRole,
					rawValue
				));
			},
		});
	}

	return signals;
}

function collectScriptSignals(
	packageName: string,
	manifest: Record<string, any>,
	candidateDependencies: Set<string>,
	manifestPath: string,
): SignalEvidence[] {
	const scripts = manifest["scripts"];
	if (!scripts || typeof scripts !== "object") return [];

	const signals: SignalEvidence[] = [];
	for (const [scriptName, scriptValue] of Object.entries(scripts)) {
		if (typeof scriptValue !== "string") continue;

		for (const dependencyName of candidateDependencies) {
			const pattern = new RegExp(
				`(^|[^a-zA-Z0-9@._/-])${dependencyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zA-Z0-9@._/-])`
			);
			if (!pattern.test(scriptValue)) continue;

			signals.push(createSignalEvidence(
				packageName,
				dependencyName,
				manifestPath,
					1,
				1,
				"script-command",
				"script",
				`${scriptName}: ${scriptValue}`
			));
		}
	}

	return signals;
}

const UNUSED_REASON: Record<UnusedDependencyClass, string> = {
	"unused-orphan":
		"Declared in the manifest but no static source reference was found, and no installed package depends on it. Removing the declaration also removes the package.",
	"unused-still-installed":
		"Declared in the manifest but no static source reference was found. It stays installed as a transitive dependency of other packages, so removing the declaration is low risk.",
	"unused-version-pin":
		"Declared in the manifest but no static source reference was found. The declared range is not accepted by every package that requires it, so removing the declaration would change version resolution.",
	"keep-peer-requirement":
		"No static source reference was found, but an installed package requires it as a peer dependency, so the declaration should stay.",
};

function collectIssueEvidence(
	packageName: string,
	summary: Result | null,
	declarations: DeclarationEvidence[],
	references: ReferenceEvidence[],
	ghostDependencies: string[],
	undeclaredWorkspaceDependencies: string[]
): IssueEvidence[] {
	const issues: IssueEvidence[] = [];
	const declarationIds = new Map<string, string[]>();
	const referenceIds = new Map<string, string[]>();

	for (const declaration of declarations) {
		const ids = declarationIds.get(declaration.dependencyName) || [];
		ids.push(declaration.id);
		declarationIds.set(declaration.dependencyName, ids);
	}

	for (const reference of references) {
		const ids = referenceIds.get(reference.dependencyName) || [];
		ids.push(reference.id);
		referenceIds.set(reference.dependencyName, ids);
	}

	for (const dependency of [...(summary?.unusedDependencies || []), ...(summary?.devDependencies || [])]) {
		if (!dependency.name) continue;
		const dependencyClass = dependency.unusedClass || "unused-orphan";

		issues.push({
			id: `${packageName}:issue:unused:${dependency.name}`,
			packageName,
			dependencyName: dependency.name,
			issueType: "unused-dependency",
			reason: UNUSED_REASON[dependencyClass],
			supportingEvidenceIds: declarationIds.get(dependency.name) || [],
			dependencyClass,
		});
	}

	for (const dependency of summary?.typeOnlyDependencies || []) {
		if (!dependency.name) continue;
		issues.push({
			id: `${packageName}:issue:type-only:${dependency.name}`,
			packageName,
			dependencyName: dependency.name,
			issueType: "type-only-dependency",
			reason: "Declared as a runtime dependency but only referenced from type positions. It can likely move to devDependencies.",
			supportingEvidenceIds: referenceIds.get(dependency.name) || [],
		});
	}

	for (const dependencyName of ghostDependencies) {
		issues.push({
			id: `${packageName}:issue:ghost:${dependencyName}`,
			packageName,
			dependencyName,
			issueType: "ghost-dependency",
			reason: "Referenced in source files but not declared in the current package manifest.",
			supportingEvidenceIds: referenceIds.get(dependencyName) || [],
		});
	}

	for (const dependencyName of undeclaredWorkspaceDependencies) {
		issues.push({
			id: `${packageName}:issue:workspace:${dependencyName}`,
			packageName,
			dependencyName,
			issueType: "undeclared-workspace-dependency",
			reason: "Referenced as a workspace package but not declared in the current package manifest.",
			supportingEvidenceIds: referenceIds.get(dependencyName) || [],
		});
	}

	return issues.sort((a, b) => {
		if (a.issueType !== b.issueType) return a.issueType.localeCompare(b.issueType);
		return a.dependencyName.localeCompare(b.dependencyName);
	});
}

/**
 * 基于已扫描/已解析的源码构建证据链。
 *
 * 旧实现会在这里重新走一遍 glob + 读盘 + 转译（monorepo 下每个包扫描三次），
 * 现在复用分析阶段的结果，引用证据与用法判定天然同源，不会再互相矛盾。
 */
export function buildPackageEvidenceChain(
	input: BuildPackageEvidenceInput
): PackageEvidenceChain {
	const declarations = collectDeclarationEvidence(
		input.packageName,
		input.manifest,
		input.manifestPath
	);
	const candidateDependencies = new Set<string>([
		...declarations.map((item) => item.dependencyName),
		...(input.workspaceNames || []),
	]);
	const signals = [
		...collectSignalEvidence(input.packageName, input.blocks, candidateDependencies),
		...collectScriptSignals(
			input.packageName,
			input.manifest,
			candidateDependencies,
			input.manifestPath
		),
	].sort((a, b) => {
		if (a.dependencyName !== b.dependencyName) return a.dependencyName.localeCompare(b.dependencyName);
		if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
		if (a.line !== b.line) return a.line - b.line;
		return a.column - b.column;
	});

	return {
		declarations,
		references: input.references,
		issues: collectIssueEvidence(
			input.packageName,
			input.summary,
			declarations,
			input.references,
			input.ghostDependencies || [],
			input.undeclaredWorkspaceDependencies || []
		),
		signals,
	};
}

export function readManifest(projectPath: string): Record<string, any> {
	const manifestPath = path.join(projectPath, "package.json");
	const raw = fs.readFileSync(manifestPath, "utf-8");
	const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
	return JSON.parse(content) as Record<string, any>;
}

export function resolvePackageName(
	projectPath: string,
	manifest: Record<string, any>,
	packageName?: string
): string {
	if (packageName && packageName.trim() !== "") return packageName;
	if (typeof manifest["name"] === "string" && manifest["name"].trim() !== "") {
		return manifest["name"];
	}
	return path.basename(path.resolve(projectPath));
}

function groupByDependency<T extends { dependencyName: string }>(items: T[]): Record<string, T[]> {
	const grouped: Record<string, T[]> = {};
	for (const item of items) {
		const bucket = grouped[item.dependencyName] || [];
		bucket.push(item);
		grouped[item.dependencyName] = bucket;
	}
	return grouped;
}

function groupByPackage<T extends { packageName: string }>(items: T[]): Record<string, T[]> {
	const grouped: Record<string, T[]> = {};
	for (const item of items) {
		const bucket = grouped[item.packageName] || [];
		bucket.push(item);
		grouped[item.packageName] = bucket;
	}
	return grouped;
}

export function buildMonorepoEvidenceIndex(
	packages: MonorepoPackageAnalysisReport[]
): MonorepoEvidenceIndex {
	const declarations = packages.flatMap((pkg) => pkg.evidence.declarations);
	const references = packages.flatMap((pkg) => pkg.evidence.references);
	const issues = packages.flatMap((pkg) => pkg.evidence.issues);
	const signals = packages.flatMap((pkg) => pkg.evidence.signals);

	return {
		packages: packages.map((pkg) => pkg.name).sort((a, b) => a.localeCompare(b)),
		declarations,
		references,
		issues,
		signals,
		declarationsByDependency: groupByDependency(declarations),
		referencesByDependency: groupByDependency(references),
		issuesByDependency: groupByDependency(issues),
		signalsByDependency: groupByDependency(signals),
		declarationsByPackage: groupByPackage(declarations),
		referencesByPackage: groupByPackage(references),
		issuesByPackage: groupByPackage(issues),
		signalsByPackage: groupByPackage(signals),
	};
}

export * from "./query";
