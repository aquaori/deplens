import { progressBarManager } from './cli-utils';
import chalk from 'chalk';
import glob from 'fast-glob';
import fs from 'fs';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { ArgumentsCamelCase } from 'yargs';
// @ts-ignore
import yaml from 'js-yaml';
import { satisfies } from 'compare-versions';
// @ts-ignore
import { minify } from 'terser';
import * as babel from '@babel/core';

/**
 * 依赖项接口定义
 * 描述项目依赖的基本信息
 */
interface Dependency {
	name: string;           // 依赖包名称
	type: string;           // 依赖类型 (import/require/dynamic)
	version: object;        // 依赖版本
	usage: boolean;         // 是否被使用
	isDev: boolean;         // 是否为开发依赖
	args?: string[];        // 参数（可选）
}

/**
 * 分析结果接口定义
 * 描述依赖分析的结果数据结构
 */
interface Result {
	usedDependencies: number;             // 已使用的依赖数量
	unusedDependencies: Dependency[];     // 未使用的依赖列表
	ununsedDependenciesCount: number;     // 未使用的依赖数量
	totalDependencies: number;            // 总依赖数量
	devDependencies: Dependency[];        // 开发依赖列表
}

/**
 * 分析项目依赖的主要函数
 * @param args 命令行参数对象
 */
export async function analyzeProject(args: ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	pnpm: boolean;
	silence: boolean;
	ignoreDep: string;
	ignorePath: string;
	ignoreFile: string;
	config: string;
}>) {
	if (!args.silence) progressBarManager.create('analysis', 4, `Analyzing project dependencies...`);

	const fileContentList = await scan(args);
	if (!args.silence) progressBarManager.advance('analysis');

	const astList = await parseAST(fileContentList);
	if (!args.silence) progressBarManager.advance('analysis');

	const [systemDeps, checkCount] = await getDependencies(args, 0);
	await parseDependencies(astList, systemDeps as Dependency[]);
	if (!args.silence) progressBarManager.advance('analysis');

	const summary = summaryData(systemDeps as Dependency[], checkCount as number) as Result;
	if (!args.silence) progressBarManager.advance('analysis');

	displayResults(summary, args);

	if (!args.silence) progressBarManager.clear('analysis');
}

/**
 * 扫描项目中的 JavaScript/TypeScript 文件
 * @param path 项目路径
 * @returns 文件内容列表
 */
async function scan(args: ArgumentsCamelCase<{
	path: string;
	ignorePath: string;
	ignoreFile: string;
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
	if (args.ignorePath !== "" ) {
		const ignorePath = args.ignorePath.split(',').map(p => "**" + p.trim() + "/**");
		ignoreList = [...ignoreList, ...ignorePath];
	}
	if(args.ignoreFile !== "") {
		const ignoreFiles = args.ignoreFile.split(',').map(f => "**" + f.trim() + "/**");
		ignoreList = [...ignoreList, ...ignoreFiles];
	}
	// 解析 ignorePath 和 ignoreFile 为数组
	// 使用 fast-glob 查找所有 JS/TS 文件，排除 node_modules 等目录
	const files = await glob(['**/*.{js,jsx,ts,tsx,mjs,cjs,vue}'], {
		cwd: args.path,
		ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/*.d.ts', ...ignoreList]
	});
	let fileList: string[] = []
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
					content = '<script></script>';
				}
			}
			const standardJS = await transpileToStandardJS(content, normalizedFile) ?? "";
			const minifiedJS = await minifyCode(standardJS) ?? "";
			fileList.push(minifiedJS);
		} catch (error) {
			console.warn(`Warning: Could not read file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return fileList;
}

/**
 * 将 TypeScript 代码转译为标准 JavaScript
 * @param sourceCode 源代码
 * @param filename 文件名
 * @returns 转译后的代码
 */
async function transpileToStandardJS(sourceCode: any, filename = 'source.js') {
		const path = require('path');

	const __dirname = path.dirname(require.main?.filename ?? process.argv[1]);

	const resolvePlugin = (name: string) => {
	return require.resolve(name, { paths: [__dirname] });
	};
	const result = babel.transformSync(sourceCode, {
		filename,
		presets: [
		[resolvePlugin('@babel/preset-typescript'), {
			allExtensions: true,
			isTSX: true,
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

/**
 * 压缩 JavaScript 代码
 * @param code 待压缩的代码
 * @returns 压缩后的代码
 */
async function minifyCode(code: string) {
	const result = await minify(code, {
		compress: {
		evaluate: true,        	   	// 启用常量折叠
		reduce_vars: true,    	    // 常量传播（内联变量）
		inline: true,         	    // 内联简单函数（可选）
		dead_code: true,      	    // 删除死代码（如 if (false)）
		unsafe: true,         	    // 允许字符串/布尔等 unsafe 优化
		passes: 3,                	// 多轮优化，提高折叠率
		},
		mangle: false,              // 不混淆变量名（便于调试，非必须）
		module: true,               // 按 ES 模块处理（支持顶层 await、import 等）
		sourceMap: false,
		keep_fnames: true,
	});
	return result.code;
}

/**
 * 将代码解析为抽象语法树(AST)
 * @param fileContentList 文件内容列表
 * @returns AST 列表
 */
async function parseAST(fileContentList: string[]) {
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

/**
 * 获取项目的依赖信息
 * @param args 命令行参数对象
 * @returns 依赖列表
 */
async function getDependencies(args: ArgumentsCamelCase<{
	path: string;
	pnpm: boolean;
	ignoreDep: string;
	config: string;
}>, checkCount: number) {
	// 根据是否使用 pnpm 确定依赖锁文件路径
	const manifestPath = args.pnpm
		? `${args.path}/pnpm-lock.yaml`
		: `${args.path}/package-lock.json`;
		
	// 检查锁文件是否存在
	if (!fs.existsSync(manifestPath)) {
		const hint = args.pnpm
			? `The ${args.path}/pnpm-lock.yaml file does not exist, so dependencies cannot be resolved.\n> If your project dependencies are managed by npm, please run deplens without the --pnpm or --pn option.`
			: `The ${args.path}/package-lock.json file does not exist, so dependencies cannot be resolved.\n> If your project dependencies are managed by pnpm, please run deplens with the --pnpm or --pn option.`;
		throw new Error(hint);
	}

	// 解析锁文件
	const rootManifest = args.pnpm
		? yaml.load(fs.readFileSync(manifestPath, 'utf-8'))
		: JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		
	let lockVersion = 0;
	if(args.pnpm) {
		lockVersion = rootManifest.lockfileVersion as number;
	}

	// 获取不同类型的依赖
	const rootProd = args.pnpm ? (lockVersion == 6 ? rootManifest.dependencies || {} : rootManifest['importers']['.']?.dependencies || {}) : rootManifest["packages"][""].dependencies || {};
	const rootPeer = args.pnpm ? (lockVersion == 6 ? rootManifest.peerDependencies || {} : rootManifest['importers']['.']?.peerDependencies || {}) : rootManifest["packages"][""].peerDependencies || {};
	const rootOpt  = args.pnpm ? (lockVersion == 6 ? rootManifest.optionalDependencies || {} : rootManifest['importers']['.']?.optionalDependencies || {}) : rootManifest["packages"][""].optionalDependencies || {};
	const rootDev  = args.pnpm ? (lockVersion == 6 ? rootManifest.devDependencies || {} : rootManifest['importers']['.']?.devDependencies || {}) : rootManifest["packages"][""].devDependencies || {};

	if (!args.pnpm) delete rootManifest["packages"][""];
	let depSource = args.pnpm ? (lockVersion == 6 ? rootManifest.packages || {} : rootManifest.snapshots || {}) : rootManifest["packages"];

	// 收集被其他包使用的依赖
	const usedByOthers = new Map<string, Set<string>>();
	for (const [key, pkg] of Object.entries(depSource)) {
		if (key === '' || !pkg || typeof pkg !== 'object') continue;
		const p = pkg as any;
		[
			p.dependencies || {},
			p.peerDependencies || {},
			p.optionalDependencies || {}
		].forEach(obj => {
			Object.entries(obj).forEach(([depName, depRange]) => {
				if (typeof depRange !== 'string') return;
				const ver = depRange.replace(/\(.+?\)+/g, '');
				if (!usedByOthers.has(depName)) usedByOthers.set(depName, new Set());
				usedByOthers.get(depName)!.add(ver);
				checkCount ++;
			});
		});
	}
	// 构建锁文件中的依赖包列表
	const lockFilePkg: Dependency[] = [];
	const rootDeclared = new Map<string, string>();
	Object.entries({ ...rootProd, ...rootPeer, ...rootOpt, ...rootDev })
		.forEach(([name, ver]) => rootDeclared.set(name, ver as string));
	for (const [name, version] of rootDeclared) {
		
		let ignoreList: string[] = []
		// 处理配置文件中指定的忽略依赖
		if (args['config'] !== "" || fs.existsSync(`${args.path}/deplens.config.json`)) {
			const configPath = args['config'] || `${args.path}/deplens.config.json`;
			const config = fs.readFileSync(configPath, 'utf8');
			const ignore = JSON.parse(config).ignoreDep || [];
			ignoreList = [...ignoreList, ...ignore];
		}
		
		// 处理命令行参数中指定的忽略依赖
		if (args['ignoreDep'] !== "") {
			const ignoreListFromArgs = args['ignoreDep'].split(',');
			ignoreList = [...ignoreList, ...ignoreListFromArgs];
		}
		if(ignoreList.includes(name)) continue;

		let pureVersion;
		if(args.pnpm) {
			pureVersion = (version as any).version.replace(/\(.+?\)+/g, '');
		}
		else {
			pureVersion = version.replace(/[\^\*\~\=\>\<]/g, '');
		}
		
		let usedVersions = usedByOthers.get(name);
		let usedVersionsList = new Set<string>();
		
		if(!args.pnpm) {
			for(let ver of usedVersions || []) {
				const verList = ver ? ver.split(" || ") : [];
				for(let ver of verList) {
					const verName = ver;
					if(verName != "") usedVersionsList.add(verName);
				}
			}
		}
		else usedVersionsList = usedVersions || new Set<string>();
		
		let isUsed = usedVersionsList ? usedVersionsList.has(pureVersion) : false;
		
		if(!args.pnpm) {
			for(let ver of usedVersionsList) {
				if(ver == "*") {
					isUsed = true;
					break;
				}
				if(satisfies(pureVersion, ver)) {
					isUsed = true;
					break;
				}
			}
		}

		if(!isUsed) {
			let preciseVersion: string = "0";
			if(typeof version == "string") preciseVersion = version.replace(/\(.+?\)+/g, '');
			else if(typeof version == "object") preciseVersion = (version as any).version.replace(/\(.+?\)+/g, '');

			const previousPkgIndex = lockFilePkg.findIndex(dep => dep.name == name);
			const previousPkg = previousPkgIndex >= 0 ? lockFilePkg[previousPkgIndex] : null;
			let previousVersion = (previousPkg as any)?.version ?? [];
			if (previousPkg !== null && previousVersion !== "") {
				if(previousVersion.length != 0 && !previousPkg?.usage)previousVersion = [...previousVersion, preciseVersion];
				else previousVersion = [preciseVersion];
			}
			else {
				previousVersion = [preciseVersion];
			};
			if(previousVersion.length != 1) previousVersion = [previousVersion.join(" & @")];
			if(previousPkgIndex >= 0 && previousPkg !== null) {
				(lockFilePkg as any)[previousPkgIndex].version = previousVersion;
			}
			else lockFilePkg.push({
				name,
				type: '',
				version: previousVersion,
				usage: isUsed,
				isDev: Object.prototype.hasOwnProperty.call(rootDev, name)
			});
		}
	}

	// 按名称排序
	lockFilePkg.sort((a, b) => a.name.localeCompare(b.name));
	return [lockFilePkg, checkCount];
}

/**
 * 解析依赖使用情况
 * @param asts AST 列表
 * @param systemDeps 系统依赖列表
 * @param args 命令行参数对象
 * @returns 解析结果
 */
async function parseDependencies(asts: any[], systemDeps: Dependency[]) {
	const dependencies: Dependency[] = [];
	
	// 遍历每个 AST 并检查导入语句
	for (const ast of asts) {
		traverse(ast, {
			// 处理 ES6 import 语句
			ImportDeclaration: (path: any) => {
				const pkgName = path.node.source.value;
				if (!dependencies.some(dep => dep.name === pkgName) && !pkgName.startsWith('.')) {
					const depIndex = systemDeps.findIndex(d => d.name === pkgName);
					if (depIndex !== -1 && systemDeps[depIndex]) {
						systemDeps[depIndex].usage = true;
						systemDeps[depIndex].type = 'import';
					}
					else {
						let target = pkgName;
						while (target.includes('/')) {
							target = target.substring(0, target.lastIndexOf('/'));
							const idx = systemDeps.findIndex(d => d.name === target);
							if (idx !== -1) {
								if (systemDeps[idx]) {
									systemDeps[idx].usage = true;
									systemDeps[idx].type = 'import';
								}
								break;
							}
						}
					}
				}
			},
			
			// 处理 CommonJS require 调用和动态导入
			CallExpression(path: any) {
				const { node } = path;
				
				// 处理 CommonJS require 调用
				if (
					node.callee.type === 'Identifier' &&
					node.callee.name === 'require' &&
					node.arguments.length === 1 &&
					node.arguments[0].type === 'StringLiteral'
				) {
					const pkgName = node.arguments[0].value;
					if (!dependencies.some(dep => dep.name === pkgName) && !pkgName.startsWith('.')) {
						const depIndex = systemDeps.findIndex(d => d.name === pkgName);
						if (depIndex !== -1 && systemDeps[depIndex]) {
							systemDeps[depIndex].usage = true;
							systemDeps[depIndex].type = 'require';
						}
						else {
							let target = pkgName;
							while (target.includes('/')) {
								target = target.substring(0, target.lastIndexOf('/'));
								const idx = systemDeps.findIndex(d => d.name === target);
								if (idx !== -1) {
									if (systemDeps[idx]) {
										systemDeps[idx].usage = true;
										systemDeps[idx].type = 'require';
									}
									break;
								}
							}
						}
					}
				}
				// 处理动态 import() 调用
				else if(
					node.callee.type === 'Import' &&
					node.arguments.length === 1 &&
					node.arguments[0].type === 'StringLiteral'
				) {
					const pkgName = node.arguments[0].value;
					if (!dependencies.some(dep => dep.name === pkgName) && !pkgName.startsWith('.')) {
						const depIndex = systemDeps.findIndex(d => d.name === pkgName);
						if (depIndex !== -1 && systemDeps[depIndex]) {
							systemDeps[depIndex].usage = true;
							systemDeps[depIndex].type = 'require';
						}
						else {
							let target = pkgName;
							while (target.includes('/')) {
								target = target.substring(0, target.lastIndexOf('/'));
								const idx = systemDeps.findIndex(d => d.name === target);
								if (idx !== -1) {
									if (systemDeps[idx]) {
										systemDeps[idx].usage = true;
										systemDeps[idx].type = 'import';
									}
									break;
								}
							}
						}
					}
				}
				// 处理动态 require/import 调用
				else if(
					(
						node.callee.type === 'Import' || node.callee.name === 'require') &&
						node.arguments[0].type !== 'StringLiteral'){
							systemDeps.push({
								name: node.arguments[0].value,
								type: 'dynamic',
								version: {},
								usage: false,
								isDev: false,
								args: path.toString()
							});
				}
			}
		});
	}
	
	return true;
}

/**
 * 汇总依赖分析数据
 * @param dependencies 依赖列表
 * @returns 汇总结果
 */
function summaryData(dependencies: Dependency[], checkCount: number) {
	const totalDepsCount = checkCount;
	const unusedDeps = dependencies.filter(dep => !dep.usage && !dep.isDev);
	const devDeps = dependencies.filter(dep => dep.isDev);
	const dynamicDeps = dependencies.filter(dep => dep.type === 'dynamic');
	
	return {
		"unusedDependencies": unusedDeps,
		"ununsedDependenciesCount": unusedDeps.length - dynamicDeps.length,
		"totalDependencies": totalDepsCount,
		"devDependencies": devDeps
	} as Result;
}

/**
 * 显示分析结果
 * @param result 分析结果对象
 * @param options 命令行选项
 */
export function displayResults(result: Result, options: ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	pnpm: boolean;
	silence: boolean;
}>): void {
	console.log('\n' + chalk.bold.green('✨ Check Results:'));
	console.log(chalk.gray('═'.repeat(50)));
	console.log(chalk.green('✓') + ` Dependency check completed successfully`);
	console.log(chalk.green('✓') + ` Analyzed ${result.totalDependencies} packages`);
	
	if (result.ununsedDependenciesCount > 0) {
		console.log(chalk.yellow('⚠') + ` Found ${result.ununsedDependenciesCount} unused dependencies : `);
	}
	else {
		console.log(chalk.green('✓') + ` No unused dependencies found`);
	}
	
	let hasDynamic = false;
	result.unusedDependencies.forEach(dep => {
		if(dep.type !== 'dynamic' && !dep.args) console.log(`   - ${dep.name}${dep.version ? ` @${(dep.version as any).join(' & @')}` : ''}`);
		else hasDynamic = true;
	});
	
	if(hasDynamic) {
		console.log(chalk.yellow('⚠') + ` Found ${result.unusedDependencies.filter(dep => dep.type === 'dynamic').length} dynamic imports that deplens cannot analyze: `);
		result.unusedDependencies.filter(dep => dep.type === 'dynamic').forEach(dep => {
			console.log(`   - ${dep.args}`);
		});
	}

	// 如果启用了详细输出，显示开发依赖信息
	if (options.verbose) {
		if (result.devDependencies.length > 0) {
			console.log(chalk.yellow('ℹ') + ` Found ${result.devDependencies.length} dev dependencies that you maybe don't need them in stable environment : `);
		}
		else {
			console.log(chalk.green('✓') + ` No dev dependencies found`);
		}
		result.devDependencies.forEach(dep => {
			console.log(`   - ${dep.name}`);
		});
	}

	console.log(chalk.gray('═'.repeat(50)));
	
	// 提示用户如何处理误报
	if(result.unusedDependencies.length > 0 && options["config"] === "" && options["ignore"] === "" && !fs.existsSync(`${options.path}/deplens.config.json`) && !options.silence) {
		console.log(chalk.yellow(`> Due to workload reasons, Deplens cannot fully support all frameworks and plugins.\n> If there are false positives, please record them in deplens.config.json or \'--ignore\' option .`));
	}
	
	// 显示启用的选项信息
	if (options.pnpm) {
		console.log(chalk.cyan('> PNPM support enabled'));
	}
	
	if (options.verbose) {
		console.log(chalk.cyan('> Verbose output enabled'));
	} else if(!options.silence) {
		console.log(chalk.cyan('> Run with --verbose for detailed output'));
	}
}