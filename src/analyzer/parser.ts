import { parse } from '@babel/parser';

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
			const ast = parse(content, {
				sourceType: 'module',
				allowImportExportEverywhere: true,
				plugins: [
					'jsx',
					'typescript',
					'dynamicImport',
					'classProperties',
					'typescript'
				],
			});
			asts.push(ast);
		} catch (error) {
			throw new Error(`\nFailed to parse file at index ${i}: \n${error instanceof Error ? error.message : String(error)}\nContent snippet: ${content.substring(0, 100)}...`);
		}
	}
	return asts;
}