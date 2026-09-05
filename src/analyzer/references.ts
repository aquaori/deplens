import traverse from "@babel/traverse";
import {
	DynamicSpecifierRecord,
	ParsedSourceBlock,
	ReferenceEvidence,
} from "../types";
import { ExternalSpecifierFilter, normalizePackageSpecifier } from "./specifier";

export interface CollectReferencesInput {
	packageName: string;
	blocks: ParsedSourceBlock[];
	filter: ExternalSpecifierFilter;
	workspaceNames?: Set<string>;
}

export interface CollectReferencesResult {
	references: ReferenceEvidence[];
	dynamicSpecifiers: DynamicSpecifierRecord[];
}

function isTypeOnlyImport(node: any): boolean {
	if (node?.importKind === "type" || node?.exportKind === "type") {
		return true;
	}

	const specifiers = node?.specifiers;
	if (!Array.isArray(specifiers) || specifiers.length === 0) {
		return false;
	}

	return specifiers.every((specifier: any) =>
		specifier?.importKind === "type" || specifier?.exportKind === "type"
	);
}

function readSourceSlice(block: ParsedSourceBlock, node: any): string {
	if (typeof node?.start !== "number" || typeof node?.end !== "number") {
		return "";
	}
	return block.code.slice(node.start, node.end).replace(/\s+/g, " ").trim();
}

function resolveLine(block: ParsedSourceBlock, node: any): number {
	return (node?.loc?.start?.line ?? 1) + block.lineOffset;
}

function resolveColumn(node: any): number {
	return (node?.loc?.start?.column ?? 0) + 1;
}

/**
 * 从 AST 中收集对外部包的静态引用。
 *
 * 这是全项目唯一一处引用检测实现：单包分析、monorepo 分析和证据链都从这里取数，
 * 避免出现「analyzer 认为没引用、evidence 里却有引用记录」这类自相矛盾的报告。
 */
export function collectReferences(input: CollectReferencesInput): CollectReferencesResult {
	const references: ReferenceEvidence[] = [];
	const dynamicSpecifiers: DynamicSpecifierRecord[] = [];
	const seenDynamic = new Set<string>();
	const workspaceNames = input.workspaceNames || new Set<string>();

	const pushReference = (
		block: ParsedSourceBlock,
		node: any,
		specifier: string,
		kind: ReferenceEvidence["kind"],
		typeOnly: boolean
	) => {
		if (!input.filter.isExternalPackage(specifier)) {
			return;
		}

		const dependencyName = normalizePackageSpecifier(specifier);
		const line = resolveLine(block, node);
		const column = resolveColumn(node);

		references.push({
			id: `${input.packageName}:ref:${block.file.path}:${line}:${column}:${dependencyName}`,
			packageName: input.packageName,
			dependencyName,
			filePath: block.file.path,
			line,
			column,
			kind,
			specifier,
			isTypeOnly: typeOnly,
			isWorkspaceReference: workspaceNames.has(dependencyName),
		});
	};

	const pushDynamic = (block: ParsedSourceBlock, node: any, kind: DynamicSpecifierRecord["kind"]) => {
		const expression = readSourceSlice(block, node) || `${kind}(<dynamic>)`;
		const key = `${block.file.path}:${resolveLine(block, node)}:${expression}`;
		if (seenDynamic.has(key)) return;
		seenDynamic.add(key);

		dynamicSpecifiers.push({
			filePath: block.file.path,
			line: resolveLine(block, node),
			kind,
			expression,
		});
	};

	for (const block of input.blocks) {
		traverse(block.ast, {
			TSImportEqualsDeclaration(nodePath: any) {
				const node = nodePath.node;
				const moduleReference = node?.moduleReference;
				const specifier = moduleReference?.expression?.value;
				if (typeof specifier === "string") {
					pushReference(block, moduleReference.expression, specifier, "require", false);
				}
			},

			TSImportType(nodePath: any) {
				const node = nodePath.node;
				const specifier = node?.argument?.value;
				if (typeof specifier === "string") {
					pushReference(block, node.argument, specifier, "dynamic-import", true);
				}
			},

			ImportDeclaration(nodePath: any) {
				const node = nodePath.node;
				const specifier = node?.source?.value;
				if (typeof specifier !== "string") return;
				pushReference(block, node.source, specifier, "import", isTypeOnlyImport(node));
			},

			// `export ... from "pkg"` / `export * from "pkg"` 同样是对该包的真实引用，
			// 旧实现完全没有处理，纯 re-export 的模块会被误判成未使用。
			ExportNamedDeclaration(nodePath: any) {
				const node = nodePath.node;
				const specifier = node?.source?.value;
				if (typeof specifier !== "string") return;
				pushReference(block, node.source, specifier, "re-export", node.exportKind === "type" || isTypeOnlyImport(node));
			},

			ExportAllDeclaration(nodePath: any) {
				const node = nodePath.node;
				const specifier = node?.source?.value;
				if (typeof specifier !== "string") return;
				pushReference(block, node.source, specifier, "re-export", isTypeOnlyImport(node));
			},

			CallExpression(nodePath: any) {
				const node = nodePath.node;
				const callee = node?.callee;
				if (!callee) return;

				const isRequireCall = callee.type === "Identifier" && callee.name === "require";
				const isDynamicImport = callee.type === "Import";
				if (!isRequireCall && !isDynamicImport) return;

				// 关键守卫：`require()` 这类零参数调用在旧实现里会直接读 arguments[0].type 而崩溃。
				const args = Array.isArray(node.arguments) ? node.arguments : [];
				const firstArgument = args[0];
				if (!firstArgument) {
					pushDynamic(block, node, isDynamicImport ? "import" : "require");
					return;
				}

				if (firstArgument.type !== "StringLiteral") {
					pushDynamic(block, node, isDynamicImport ? "import" : "require");
					return;
				}

				pushReference(
					block,
					firstArgument,
					firstArgument.value,
					isDynamicImport ? "dynamic-import" : "require",
					false
				);
			},
		});
	}

	references.sort((a, b) => {
		if (a.dependencyName !== b.dependencyName) return a.dependencyName.localeCompare(b.dependencyName);
		if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
		if (a.line !== b.line) return a.line - b.line;
		return a.column - b.column;
	});

	dynamicSpecifiers.sort((a, b) => {
		if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
		return a.line - b.line;
	});

	return { references, dynamicSpecifiers };
}

/**
 * 从引用列表中取出被引用到的外部包名集合。
 */
export function toReferencedDependencyNames(
	references: ReferenceEvidence[],
	options: { includeTypeOnly?: boolean } = {}
): Set<string> {
	const includeTypeOnly = options.includeTypeOnly !== false;
	const names = new Set<string>();
	for (const reference of references) {
		if (!includeTypeOnly && reference.isTypeOnly) continue;
		names.add(reference.dependencyName);
	}
	return names;
}
