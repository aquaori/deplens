import { ArgumentsCamelCase } from 'yargs';
import fs from 'fs';
import glob from 'fast-glob';
import { transpileToStandardJS } from '../utils/transpiler';
import { minifyCode } from '../utils/minifier';
import { logInQueue } from '../utils/logQueue';

/**
 * 扫描项目中的 JavaScript/TypeScript 文件
 * @param path 项目路径
 * @returns 文件内容列表
 */
export async function scan(args: ArgumentsCamelCase<{
    path: string;
    ignoreDep: string;
    ignorePath: string;
    ignoreFile: string;
    verbose: boolean;
}>) {
    let ignoreList: string[] = [];
    if (args['config'] !== "" || fs.existsSync(`${args.path}/deplens.config.json`)) {
            const configPath = args['config'] || `${args.path}/deplens.config.json`;
            const config = fs.readFileSync(configPath as string, 'utf8');
            const configArray = JSON.parse(config);
            const ignorePath = configArray.ignorePath || [];
            const ignorePathPath = ignorePath.map((path: string) => "**" + path.trim() + "/**");
            const ignoreFile = configArray.ignoreFile || [];
            const ignoreFilePath = ignoreFile.map((file: string) => "**" + file.trim() + "/**");
            ignoreList = [...ignoreList, ...ignorePathPath, ...ignoreFilePath];
        }
        
    // 处理命令行参数中指定的忽略依赖
    if (args.ignoreDep !== "" ) {
        const ignoreDep = args.ignoreDep.split(/[\s\,]+/).map(p => "**" + p.trim() + "/**");
        ignoreList = [...ignoreList, ...ignoreDep];
    }
    if (args.ignorePath !== "" ) {
        const ignorePath = args.ignorePath.split(/[\s\,]+/).map(p => "**" + p.trim() + "/**");
        ignoreList = [...ignoreList, ...ignorePath];
    }
    if(args.ignoreFile !== "") {
        const ignoreFiles = args.ignoreFile.split(/[\s\,]+/).map(f => "**" + f.trim() + "/**");
        ignoreList = [...ignoreList, ...ignoreFiles];
    }
    // 解析 ignorePath 和 ignoreFile 为数组
    // 使用 fast-glob 查找所有 JS/TS 文件，排除 node_modules 等目录
    const files = await glob(['**/*.{js,jsx,ts,tsx,mjs,cjs,vue}'], {
        cwd: args.path,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/*.d.ts', ...ignoreList]
    });
    let fileList: string[] = []
    let errorCount = 0
    for (const file of files) {
        const sep = process.platform === 'win32' ? '\\' : '/';
        const fileExtension = file.split('.').pop();
        const normalizedFile = file.replace(/\//g, sep);
        const fullPath = `${args.path}${sep}${normalizedFile}`;
        try {
            let content = fs.readFileSync(fullPath, 'utf-8');
            if (fileExtension === 'vue') {
                // 提取 <script> 标签中的内容，忽略 template/style 等
                const scriptMatch = content.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
                if (scriptMatch && scriptMatch[1]) {
                    content = scriptMatch[1];
                } else {
                    content = 'console.log(\'\')';
                }
            }
            const standardJS = await transpileToStandardJS(content, args.path, normalizedFile) ?? "";
            const minifiedJS = await minifyCode(standardJS) ?? "";
            fileList.push(minifiedJS);
        } catch (error) {
            if(args.verbose) {
                logInQueue(` Error: Failed to read file ${normalizedFile}. Error: ${error}`, 'error')
            }
            else errorCount++;
        }
    }
    if(errorCount > 0 && !args.verbose) {
        logInQueue(` Warning: ${errorCount} files read failed. Try to use \`--verbose\` to see more details.`, 'warn')
    }
    return fileList;
}