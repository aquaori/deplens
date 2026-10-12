import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import { resolveFileRole } from "../evidence";
import type { ReviewEvidenceRecord } from "../types";

interface LocalQuestionContext {
	fileRole: ReturnType<typeof resolveFileRole>;
	stringConsumer: boolean;
	loadRelations?: LocalLoadRelation[];
	inlineScripts?: Array<{ task: string; code?: string; status: "parsed" | "unparsed"; loadRelations?: LocalLoadRelation[] }>;
}

export type LocalLoadRelation = {
	expression: string;
	specifier: string | null;
	line: number;
};

// Deliberately small constant resolver, not an interpreter. It never invokes
// source functions. Mutable bindings, object properties and unknown calls stay
// unresolved; arrays are supported only as immediate literal join expressions.
function constantString(expression: NodePath, seen = new Set<object>(), depth = 0): string | undefined {
	if (depth > 12) return undefined;
	if (expression.node.type === "StringLiteral") return expression.node.value;
	if (expression.node.type === "Identifier") {
		const binding = expression.scope.getBinding(expression.node.name);
		if (!binding || binding.kind !== "const" || !binding.constant || seen.has(binding) || !binding.path.isVariableDeclarator()
			|| (binding.path.node.start ?? 0) >= (expression.node.start ?? 0)) return undefined;
		const init = binding.path.get("init");
		return init.node ? constantString(init, new Set([...seen, binding]), depth + 1) : undefined;
	}
	if (expression.node.type === "BinaryExpression" && expression.node.operator === "+") {
		const left = constantString(expression.get("left") as NodePath, seen, depth + 1);
		const right = constantString(expression.get("right") as NodePath, seen, depth + 1);
		return left !== undefined && right !== undefined && left.length + right.length <= 4096 ? left + right : undefined;
	}
	if (expression.node.type === "CallExpression") {
		if (expression.node.callee.type !== "MemberExpression") return undefined;
		const callee = expression.get("callee") as NodePath;
		const args = expression.get("arguments") as NodePath[];
		if (callee.node.computed || callee.node.property.type !== "Identifier" || callee.node.property.name !== "join"
			|| callee.node.object.type !== "ArrayExpression" || args.length > 1) return undefined;
		const array = callee.get("object") as NodePath;
		if (array.node.elements.length > 64) return undefined;
		const separator = args.length ? constantString(args[0]!, seen, depth + 1) : ",";
		const values = (array.get("elements") as NodePath[]).map((item) => item.node ? constantString(item, seen, depth + 1) : undefined);
		if (separator === undefined || values.some((item) => item === undefined)) return undefined;
		const joined = (values as string[]).join(separator);
		return joined.length <= 4096 ? joined : undefined;
	}
	return undefined;
}

function sourceContext(content: string, dependency: string) {
	const ast = parse(content, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
	const loads: LocalLoadRelation[] = [];
	let nameString = false;
	let indirect = false;
	let dynamicCode = false;
	traverse(ast, {
		StringLiteral(nodePath) { if (nodePath.node.value === dependency) nameString = true; },
		ImportDeclaration(nodePath) {
			loads.push({ expression: content.slice(nodePath.node.start!, nodePath.node.end!), specifier: nodePath.node.source.value, line: nodePath.node.loc?.start.line || 1 });
		},
		CallExpression(nodePath) {
			const callee = nodePath.node.callee;
			if (callee.type === "Identifier" && ["eval", "Function"].includes(callee.name)) dynamicCode = true;
			if (callee.type !== "Import" && !(callee.type === "Identifier" && callee.name === "require" && !nodePath.scope.getBinding("require"))) return;
			const args = nodePath.get("arguments");
			const argument = args[0];
			const specifier = argument && args.length === 1 ? constantString(argument) : undefined;
			if (!argument?.isStringLiteral()) indirect = true;
			loads.push({ expression: content.slice(nodePath.node.start!, nodePath.node.end!), specifier: specifier ?? null, line: nodePath.node.loc?.start.line || 1 });
		},
		NewExpression(nodePath) { if (nodePath.node.callee.type === "Identifier" && nodePath.node.callee.name === "Function") dynamicCode = true; },
	});
	// Dynamic code may change bindings or introduce consumers not represented by
	// the AST. Do not present our selected relations as a complete inventory.
	if (dynamicCode) for (const load of loads) load.specifier = null;
	const unrelated = loads.every((load) => load.specifier !== null && load.specifier !== dependency && !load.specifier.startsWith(dependency + "/"));
	return { stringConsumer: nameString && unrelated && !dynamicCode,
		...(indirect && !dynamicCode && loads.some((load) => load.specifier !== null) ? { loadRelations: loads.slice(0, 32) } : {}) };
}

export function getLocalQuestionContext(record: ReviewEvidenceRecord, dependency: string): LocalQuestionContext {
	const fileRole = resolveFileRole(record.filePath || "");
	try {
		if (record.filePath?.endsWith(".json")) {
			const data = JSON.parse(record.content || "{}");
			const inlineScripts: Array<{ task: string; code?: string; status: "parsed" | "unparsed"; loadRelations?: LocalLoadRelation[] }> = [];
			if (record.filePath === "package.json" && data.scripts && typeof data.scripts === "object") {
				for (const [task, command] of Object.entries(data.scripts)) {
					if (typeof command !== "string" || !/^node\s+(?:-e|--eval)\s/.test(command.trim())) continue;
					// Recognize only a whole, quoted command without quote escapes,
					// interpolation or shell chaining; retain everything else as unknown.
					const match = /^node\s+(?:-e|--eval)\s+(?:"([^"\\$`\r\n]*)"|'([^'\r\n]*)')\s*$/.exec(command.trim());
					if (!match) { inlineScripts.push({ task, status: "unparsed" }); continue; }
					const code = match[1] ?? match[2]!;
					try { const context = sourceContext(code, dependency); inlineScripts.push({ task, code, status: "parsed", ...(context.loadRelations ? { loadRelations: context.loadRelations } : {}) }); }
					catch { inlineScripts.push({ task, code, status: "unparsed" }); }
				}
			}
			return { fileRole, stringConsumer: false, ...(inlineScripts.length ? { inlineScripts } : {}) };
		}
		return { fileRole, ...sourceContext(record.content || "", dependency) };
	} catch { return { fileRole, stringConsumer: true }; }
}
