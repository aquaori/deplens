import * as babel from '@babel/core';

/**
 * 将 TypeScript 代码转译为标准 JavaScript
 * @param sourceCode 源代码
 * @param filename 文件名
 * @returns 转译后的代码
 */
export async function transpileToStandardJS(sourceCode: any, rootPath: string, filename = 'source.js') {
    const path = require('path');
    const __dirname = path.dirname(require.main?.filename ?? process.argv[1]);
    const resolvePlugin = (name: string) => {
    return require.resolve(name, { paths: [__dirname] });
    };
    const sep = process.platform === 'win32' ? '\\' : '/';
    const fullPath = rootPath + sep + filename;
    const result = babel.transformSync(sourceCode, {
        filename: fullPath,
        presets: [
        [resolvePlugin('@babel/preset-typescript'), {
            allExtensions: true,
            isTSX: true
        }],
        [resolvePlugin('@babel/preset-react'), {
            runtime: 'automatic',
        }]
        ],
        plugins: [
        [resolvePlugin('@babel/plugin-syntax-import-assertions'), {}],
        [resolvePlugin('@babel/plugin-syntax-top-level-await'), {}],
        ],
        ast: false,
        sourceMaps: false,
        configFile: false,
        babelrc: false,
    });

    if (!result || !result.code) {
        throw new Error('Babel transpilation failed');
    }

        return result.code;
}