import fs from "fs";
import path from "path";
import { builtinModules } from "module";
import traverse from "@babel/traverse";
import { parse } from "@babel/parser";
import { ArgumentsCamelCase } from "yargs";
import {
	AnalysisCliArgs,
	DeclarationEvidence,
	IssueEvidence,
	MonorepoEvidenceIndex,
	MonorepoPackageAnalysisReport,
	PackageEvidenceChain,
	ReferenceEvidence,
	Result,
	ScannedSourceFile,
	SignalEvidence,
} from "../types";
import { readProjectSourceFiles } from "../analyzer/scanner";

type AnalyzeArgs = ArgumentsCamelCase<AnalysisCliArgs>;

interface BuildPackageEvidenceInput {
	args: AnalyzeArgs;
	packageName?: string;
	manifest?: Record<string, any>;
	manifestPath?: string;
	summary: Result | null;
	ghostDependencies?: string[];
	undeclaredWorkspaceDependencies?: string[];
	workspaceNames?: string[];
}

type ManifestDependencySection =
	| "dependencies"
	| "devDependencies"
	| "peerDependencies"
	| "optionalDependencies";

function normalizePackageSpecifier(specifier: string): string {
	if (specifier.startsWith("@")) {
		const parts = specifier.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
	}
	return specifier.split("/")[0] || specifier;
}

function isBuiltInModule(specifier: string): boolean {
	const normalizedSpecifier = specifier.startsWith("node:")
		? specifier.slice("node:".length)
		: specifier;
	return builtinModules.includes(normalizedSpecifier);
}

function getManifestPath(projectPath: string, manifestPath?: string): string {
	const resolvedManifestPath = manifestPath || path.join(projectPath, "package.json");
	return path.relative(projectPath, resolvedManifestPath).replace(/\\/g, "/") || "package.json";
}

function shouldRetryWithDeprecatedImportAssert(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.message.includes("deprecatedImportAssert")
		|| error.message.includes("assert keyword in import attributes is deprecated")
		|| error.message.includes("has been replaced by the `with` keyword");
}

function buildParserPlugins(useDeprecatedImportAssert: boolean) {
	return [
		"jsx",
		"typescript",
		"dynamicImport",
		"classProperties",
		useDeprecatedImportAssert ? "deprecatedImportAssert" : "importAttributes",
	] as any;
}

function readManifest(projectPath: string, manifest?: Record<string, any>): Record<string, any> {
	if (manifest) return manifest;
	const manifestPath = path.join(projectPath, "package.json");
	return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, any>;
}

function resolvePackageName(projectPath: string, manifest: Record<string, any>, packageName?: string): string {
	if (packageName && packageName.trim() !== "") return packageName;
	if (typeof manifest["name"] === "string" && manifest["name"].trim() !== "") {
		return manifest["name"];
	}
	return path.basename(path.resolve(projectPath));
}

function collectDeclarationEvidence(
	resolvedPackageName: string,
	manifest: Record<string, any>,
	manifestPath: string
): DeclarationEvidence[] {
	const sections: ManifestDependencySection[] = [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	];
	const declarations: DeclarationEvidence[] = [];

	for (const section of sections) {
		const dependencyMap = manifest[section];
		if (!dependencyMap || typeof dependencyMap !== "object") continue;

		for (const [dependencyName, versionRange] of Object.entries(dependencyMap)) {
			declarations.push({
				id: `${resolvedPackageName}:decl:${section}:${dependencyName}`,
				packageName: resolvedPackageName,
				dependencyName,
				manifestPath,
				section,
				versionRange: String(versionRange),
			});
		}
	}

	return declarations.sort((a, b) => a.dependencyName.localeCompare(b.dependencyName));
}

function parseSourceAst(sourceFile: ScannedSourceFile) {
	try {
		return parse(sourceFile.code, {
			sourceType: "module",
			sourceFilename: sourceFile.path,
			allowImportExportEverywhere: true,
			plugins: buildParserPlugins(false),
		});
	} catch (error) {
		if (!shouldRetryWithDeprecatedImportAssert(error)) {
			throw error;
		}

		return parse(sourceFile.code, {
			sourceType: "module",
			sourceFilename: sourceFile.path,
			allowImportExportEverywhere: true,
			plugins: buildParserPlugins(true),
		});
	}
}

function createReferenceEvidence(
	resolvedPackageName: string,
	sourceFile: ScannedSourceFile,
	workspaceNames: Set<string>,
	kind: ReferenceEvidence["kind"],
	specifier: string,
	line: number,
	column: number
): ReferenceEvidence {
	const dependencyName = normalizePackageSpecifier(specifier);
	return {
		id: `${resolvedPackageName}:ref:${sourceFile.path}:${line}:${column}:${dependencyName}`,
		packageName: resolvedPackageName,
		dependencyName,
		filePath: sourceFile.path,
		line,
		column,
		kind,
		specifier,
		isWorkspaceReference: workspaceNames.has(dependencyName),
	};
}

function createSignalEvidence(
	resolvedPackageName: string,
	dependencyName: string,
	filePath: string,
	line: number,
	column: number,
	signalType: SignalEvidence["signalType"],
	fileRole: SignalEvidence["fileRole"],
	value: string
): SignalEvidence {
	return {
		id: `${resolvedPackageName}:signal:${signalType}:${filePath}:${line}:${column}:${dependencyName}`,
		packageName: resolvedPackageName,
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

function resolveFileRole(filePath: string): SignalEvidence["fileRole"] {
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
		|| normalizedPath.includes("tailwind.config")
		|| normalizedPath.includes("vite.config")
		|| normalizedPath.includes("vitest.config")
		|| normalizedPath.includes("babel.config")
		|| normalizedPath.includes("postcss.config")
		|| normalizedPath.includes("eslint.config")
	) {
		return "config";
	}
	return "source";
}

function getNodeKeyName(node: any): string | undefined {
	if (!node) {
		return undefined;
	}
	if (node.type === "Identifier") {
		return node.name;
	}
	if (node.type === "StringLiteral") {
		return node.value;
	}
	return undefined;
}

function getCalleeName(callee: any): string | undefined {
	if (!callee) {
		return undefined;
	}
	if (callee.type === "Identifier") {
		return callee.name;
	}
	if (callee.type === "MemberExpression") {
		const propertyName = getNodeKeyName(callee.property);
		if (propertyName) {
			return propertyName;
		}
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

function collectReferenceEvidence(
	resolvedPackageName: string,
	sourceFiles: ScannedSourceFile[],
	workspaceNames: Set<string>
): ReferenceEvidence[] {
	const references: ReferenceEvidence[] = [];

	for (const sourceFile of sourceFiles) {
		const ast = parseSourceAst(sourceFile);
		traverse(ast, {
			ImportDeclaration(importPath: any) {
				const specifier = importPath.node?.source?.value;
				if (
					typeof specifier !== "string" ||
					specifier.startsWith(".") ||
					specifier.startsWith("node:") ||
					isBuiltInModule(specifier)
				) {
					return;
				}

				const line = importPath.node?.source?.loc?.start?.line ?? 1;
				const column = (importPath.node?.source?.loc?.start?.column ?? 0) + 1;
				references.push(
					createReferenceEvidence(
						resolvedPackageName,
						sourceFile,
						workspaceNames,
						"import",
						specifier,
						line,
						column
					)
				);
			},
			CallExpression(callPath: any) {
				const { node } = callPath;
				if (!node || !Array.isArray(node.arguments) || node.arguments.length !== 1) {
					return;
				}

				const argument = node.arguments[0];
				if (argument?.type !== "StringLiteral") {
					return;
				}

				const specifier = argument.value;
				if (
					typeof specifier !== "string" ||
					specifier.startsWith(".") ||
					specifier.startsWith("node:") ||
					isBuiltInModule(specifier)
				) {
					return;
				}

				let kind: ReferenceEvidence["kind"] | null = null;
				if (node.callee?.type === "Identifier" && node.callee.name === "require") {
					kind = "require";
				} else if (node.callee?.type === "Import") {
					kind = "dynamic-import";
				}

				if (!kind) return;

				const line = argument.loc?.start?.line ?? 1;
				const column = (argument.loc?.start?.column ?? 0) + 1;
				references.push(
					createReferenceEvidence(
						resolvedPackageName,
						sourceFile,
						workspaceNames,
						kind,
						specifier,
						line,
						column
					)
				);
			},
		});
	}

	return references.sort((a, b) => {
		if (a.dependencyName !== b.dependencyName) {
			return a.dependencyName.localeCompare(b.dependencyName);
		}
		if (a.filePath !== b.filePath) {
			return a.filePath.localeCompare(b.filePath);
		}
		if (a.line !== b.line) {
			return a.line - b.line;
		}
		return a.column - b.column;
	});
}

function collectSignalEvidence(
	resolvedPackageName: string,
	sourceFiles: ScannedSourceFile[],
	candidateDependencies: Set<string>
): SignalEvidence[] {
	const signals: SignalEvidence[] = [];
	const seen = new Set<string>();

	for (const sourceFile of sourceFiles) {
		const ast = parseSourceAst(sourceFile);
		const fileRole = resolveFileRole(sourceFile.path);

		traverse(ast, {
			StringLiteral(stringPath: any) {
				const rawValue = stringPath.node?.value;
				if (typeof rawValue !== "string" || !looksLikePackageSpecifier(rawValue)) {
					return;
				}

				const dependencyName = normalizePackageSpecifier(rawValue);
				if (!candidateDependencies.has(dependencyName) || isBuiltInModule(dependencyName)) {
					return;
				}

				const parent = stringPath.parentPath?.node;
				if (parent?.type === "ImportDeclaration") {
					return;
				}
				if (
					parent?.type === "CallExpression"
					&& parent.callee?.type === "Identifier"
					&& (parent.callee.name === "require" || parent.callee.name === "import")
				) {
					return;
				}

				const line = stringPath.node?.loc?.start?.line ?? 1;
				const column = (stringPath.node?.loc?.start?.column ?? 0) + 1;
				const signalType: SignalEvidence["signalType"] = hasToolingHintInAncestors(stringPath)
					? "tooling-string"
					: "string-literal";
				const signal = createSignalEvidence(
					resolvedPackageName,
					dependencyName,
					sourceFile.path,
					line,
					column,
					signalType,
					fileRole,
					rawValue
				);
				if (!seen.has(signal.id)) {
					signals.push(signal);
					seen.add(signal.id);
				}
			},
			CallExpression(callPath: any) {
				const { node } = callPath;
				if (!node || !Array.isArray(node.arguments) || node.arguments.length !== 1) {
					return;
				}

				const argument = node.arguments[0];
				if (argument?.type !== "StringLiteral") {
					return;
				}

				const rawValue = argument.value;
				if (typeof rawValue !== "string" || !looksLikePackageSpecifier(rawValue)) {
					return;
				}

				const dependencyName = normalizePackageSpecifier(rawValue);
				if (!candidateDependencies.has(dependencyName) || isBuiltInModule(dependencyName)) {
					return;
				}

				const isRequireResolve =
					node.callee?.type === "MemberExpression"
					&& node.callee.object?.type === "Identifier"
					&& node.callee.object.name === "require"
					&& node.callee.property?.type === "Identifier"
					&& node.callee.property.name === "resolve";

				if (!isRequireResolve) {
					return;
				}

				const fileRole = resolveFileRole(sourceFile.path);
				const line = argument.loc?.start?.line ?? 1;
				const column = (argument.loc?.start?.column ?? 0) + 1;
				const signal = createSignalEvidence(
					resolvedPackageName,
					dependencyName,
					sourceFile.path,
					line,
					column,
					"require-resolve",
					fileRole,
					rawValue
				);
				if (!seen.has(signal.id)) {
					signals.push(signal);
					seen.add(signal.id);
				}
			},
		});
	}

	return signals.sort((a, b) => {
		if (a.dependencyName !== b.dependencyName) {
			return a.dependencyName.localeCompare(b.dependencyName);
		}
		if (a.filePath !== b.filePath) {
			return a.filePath.localeCompare(b.filePath);
		}
		if (a.line !== b.line) {
			return a.line - b.line;
		}
		return a.column - b.column;
	});
}

function collectScriptSignals(
	resolvedPackageName: string,
	manifest: Record<string, any>,
	candidateDependencies: Set<string>,
	manifestPath: string
): SignalEvidence[] {
	const scripts = manifest["scripts"];
	if (!scripts || typeof scripts !== "object") {
		return [];
	}

	const signals: SignalEvidence[] = [];
	for (const [scriptName, scriptValue] of Object.entries(scripts)) {
		if (typeof scriptValue !== "string") {
			continue;
		}

		for (const dependencyName of candidateDependencies) {
			const pattern = new RegExp(`(^|[^a-zA-Z0-9@._/-])${dependencyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zA-Z0-9@._/-])`);
			if (!pattern.test(scriptValue)) {
				continue;
			}

			signals.push(
				createSignalEvidence(
					resolvedPackageName,
					dependencyName,
					manifestPath,
					1,
					1,
					"script-command",
					"script",
					`${scriptName}: ${scriptValue}`
				)
			);
		}
	}

	return signals.sort((a, b) => a.dependencyName.localeCompare(b.dependencyName));
}

function collectIssueEvidence(
	resolvedPackageName: string,
	summary: Result | null,
	declarations: DeclarationEvidence[],
	references: ReferenceEvidence[],
	ghostDependencies: string[],
	undeclaredWorkspaceDependencies: string[]
): IssueEvidence[] {
	const issues: IssueEvidence[] = [];
	const declarationIdsByDependency = new Map<string, string[]>();
	const referenceIdsByDependency = new Map<string, string[]>();

	for (const declaration of declarations) {
		const ids = declarationIdsByDependency.get(declaration.dependencyName) || [];
		ids.push(declaration.id);
		declarationIdsByDependency.set(declaration.dependencyName, ids);
	}

	for (const reference of references) {
		const ids = referenceIdsByDependency.get(reference.dependencyName) || [];
		ids.push(reference.id);
		referenceIdsByDependency.set(reference.dependencyName, ids);
	}

	for (const dependency of summary?.unusedDependencies || []) {
		if (dependency.type === "dynamic" || !dependency.name || dependency.name === "undefined") {
			continue;
		}

		issues.push({
			id: `${resolvedPackageName}:issue:unused:${dependency.name}`,
			packageName: resolvedPackageName,
			dependencyName: dependency.name,
			issueType: "unused-dependency",
			reason: "Declared in package.json but no static source references were found.",
			supportingEvidenceIds: declarationIdsByDependency.get(dependency.name) || [],
		});
	}

	for (const dependencyName of ghostDependencies) {
		issues.push({
			id: `${resolvedPackageName}:issue:ghost:${dependencyName}`,
			packageName: resolvedPackageName,
			dependencyName,
			issueType: "ghost-dependency",
			reason: "Referenced in source files but not declared in the current package manifest.",
			supportingEvidenceIds: referenceIdsByDependency.get(dependencyName) || [],
		});
	}

	for (const dependencyName of undeclaredWorkspaceDependencies) {
		issues.push({
			id: `${resolvedPackageName}:issue:workspace:${dependencyName}`,
			packageName: resolvedPackageName,
			dependencyName,
			issueType: "undeclared-workspace-dependency",
			reason: "Referenced as a workspace package but not declared in the current package manifest.",
			supportingEvidenceIds: referenceIdsByDependency.get(dependencyName) || [],
		});
	}

	return issues.sort((a, b) => {
		if (a.issueType !== b.issueType) {
			return a.issueType.localeCompare(b.issueType);
		}
		return a.dependencyName.localeCompare(b.dependencyName);
	});
}

export async function buildPackageEvidenceChain(
	input: BuildPackageEvidenceInput
): Promise<PackageEvidenceChain> {
	const manifest = readManifest(input.args.path, input.manifest);
	const resolvedPackageName = resolvePackageName(input.args.path, manifest, input.packageName);
	const sourceFiles = await readProjectSourceFiles(input.args);
	const workspaceNames = new Set(input.workspaceNames || []);
	const manifestPath = getManifestPath(input.args.path, input.manifestPath);
	const declarations = collectDeclarationEvidence(
		resolvedPackageName,
		manifest,
		manifestPath
	);
	const candidateDependencies = new Set<string>([
		...declarations.map((item) => item.dependencyName),
		...(input.workspaceNames || []),
	]);
	const references = collectReferenceEvidence(
		resolvedPackageName,
		sourceFiles,
		workspaceNames
	);
	const signals = [
		...collectSignalEvidence(
			resolvedPackageName,
			sourceFiles,
			candidateDependencies
		),
		...collectScriptSignals(
			resolvedPackageName,
			manifest,
			candidateDependencies,
			manifestPath
		),
	];
	const issues = collectIssueEvidence(
		resolvedPackageName,
		input.summary,
		declarations,
		references,
		input.ghostDependencies || [],
		input.undeclaredWorkspaceDependencies || []
	);

	return {
		declarations,
		references,
		issues,
		signals,
	};
}

function groupByDependency<T extends { dependencyName: string }>(items: T[]): Record<string, T[]> {
	const grouped: Record<string, T[]> = {};
	for (const item of items) {
		const dependencyKey = item.dependencyName;
		const bucket = grouped[dependencyKey] || [];
		bucket.push(item);
		grouped[dependencyKey] = bucket;
	}
	return grouped;
}

function groupByPackage<T extends { packageName: string }>(items: T[]): Record<string, T[]> {
	const grouped: Record<string, T[]> = {};
	for (const item of items) {
		const packageKey = item.packageName;
		const bucket = grouped[packageKey] || [];
		bucket.push(item);
		grouped[packageKey] = bucket;
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
