import { parse } from '@babel/parser';

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
		'jsx',
		'typescript',
		'dynamicImport',
		'classProperties',
		useDeprecatedImportAssert ? 'deprecatedImportAssert' : 'importAttributes',
		'typescript'
	] as any;
}

/**
 * 将代码解析为抽象语法树(AST)
 * @param fileContentList 文件内容列表
 * @returns AST 列表
 */
export async function parseAST(fileContentList: string[]) {
	const asts = [];
	for (let i = 0; i < fileContentList.length; i++) {
		const content = fileContentList[i];
		if (typeof content !== 'string') {
			console.warn(`Warning: Skipping non-string content at index ${i}`);
			continue;
		}
		try {
			let ast;
			try {
				ast = parse(content, {
					sourceType: 'module',
					allowImportExportEverywhere: true,
					plugins: buildParserPlugins(false),
				});
			} catch (error) {
				if (!shouldRetryWithDeprecatedImportAssert(error)) {
					throw error;
				}

				ast = parse(content, {
					sourceType: 'module',
					allowImportExportEverywhere: true,
					plugins: buildParserPlugins(true),
				});
			}
			asts.push(ast);
		} catch (error) {
			throw new Error(`\nFailed to parse file at index ${i}: \n${error instanceof Error ? error.message : String(error)}\nContent snippet: ${content.substring(0, 100)}...`);
		}
	}
	return asts;
}
