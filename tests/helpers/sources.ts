import path from "path";
import { ParsedSourceBlock, ScannedSourceFile } from "../../src/types";
import { parseSources } from "../../src/analyzer/parser";

export function sourceFile(relativePath: string, code: string): ScannedSourceFile {
	return {
		path: relativePath,
		absolutePath: path.resolve("/virtual", relativePath),
		originalCode: code,
		blocks: [{ code, lineOffset: 0 }],
	};
}

export function parseCode(code: string, relativePath = "src/index.ts"): ParsedSourceBlock[] {
	return parseSources([sourceFile(relativePath, code)]).blocks;
}
