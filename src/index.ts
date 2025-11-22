/**
 * Deplens - A precise dependency analysis tool for pnpm projects
 */

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

// import babelTypes from '@babel/types';



// Function to simulate work with a delay
// function simulateWork(delay: number): Promise<void> {
//   return new Promise(resolve => setTimeout(resolve, delay));
// }

interface Dependency {
	name: string;
	type: string;
	version: string;
	usage: boolean;
	isDev: boolean;
}



interface Result {
	usedDependencies: number;
	unusedDependencies: Dependency[];
	ununsedDependenciesCount: number;
	totalDependencies: number;
	devDependencies: Dependency[];
}

/**
 * Analyze project dependencies
 * @param path Path to analyze (defaults to current directory)
 */
export async function analyzeProject(args: ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	pnpm: boolean;
	silence: boolean;
	ignore: string;
	config: string;
}>) {
	// Create a progress bar for the analysis
	if (!args.silence) progressBarManager.create('analysis', 4, `Analyzing project dependencies...`);

	const fileContentList = await scan(args.path as string);
	if (!args.silence) progressBarManager.advance('analysis');

	const astList = await parseAST(fileContentList);
	if (!args.silence) progressBarManager.advance('analysis');

	const systemDeps = await getDependencies(args);
	await parseDependencies(astList, systemDeps, args);
	if (!args.silence) progressBarManager.advance('analysis');

	const summary = summaryData(systemDeps) as Result;
	if (!args.silence) progressBarManager.advance('analysis');

	displayResults(summary, args);

	// Clear the progress bar when done
	if (!args.silence) progressBarManager.clear('analysis');

}

async function scan(path: string) {
	const files = await glob(['**/*.{js,jsx,ts,tsx,mjs,cjs}'], {
		cwd: path,
		ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/generated/**']
	});
	let fileList: string[] = []
	for (const file of files) {
		const sep = process.platform === 'win32' ? '\\' : '/';
		const normalizedFile = file.replace(/\//g, sep);
		const fullPath = `${path}${sep}${normalizedFile}`;
		try {
			const content = fs.readFileSync(fullPath, 'utf-8');
			fileList.push(content);
		} catch (error) {
			console.warn(`Warning: Could not read file ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
			// Continue with other files
		}
	}
	return fileList;
}

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

async function getDependencies(args: ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	pnpm: boolean;
	silence: boolean;
	ignore: string;
	config: string;
}>) {
	// 根据包管理器决定读取的“根声明文件”
	const manifestPath = args.pnpm
		? `${args.path}/pnpm-lock.yaml`
		: `${args.path}/package-lock.json`;
	if (!fs.existsSync(manifestPath)) {
		const hint = args.pnpm
			? `The ${args.path}/pnpm-lock.yaml file does not exist, so dependencies cannot be resolved.\n> If your project dependencies are managed by npm, please run deplens without the --pnpm or --pn option.`
			: `The ${args.path}/package-lock.json file does not exist, so dependencies cannot be resolved.\n> If your project dependencies are managed by pnpm, please run deplens with the --pnpm or --pn option.`;
		throw new Error(hint);
	}

	// 读取根声明文件内容
	const rootManifest = args.pnpm
		? yaml.load(fs.readFileSync(manifestPath, 'utf-8'))
		: JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
	let lockVersion = 0;
	if(args.pnpm) {
		lockVersion = rootManifest.lockfileVersion as number;
	}

	// 提取根级依赖声明
	const rootProd = args.pnpm ? (lockVersion == 6 ? rootManifest.dependencies || {} : rootManifest['importers']['.']?.dependencies || {}) : rootManifest["packages"][""].dependencies || {};
	const rootPeer = args.pnpm ? (lockVersion == 6 ? rootManifest.peerDependencies || {} : rootManifest['importers']['.']?.peerDependencies || {}) : rootManifest["packages"][""].peerDependencies || {};
	const rootOpt  = args.pnpm ? (lockVersion == 6 ? rootManifest.optionalDependencies || {} : rootManifest['importers']['.']?.optionalDependencies || {}) : rootManifest["packages"][""].optionalDependencies || {};
	const rootDev  = args.pnpm ? (lockVersion == 6 ? rootManifest.devDependencies || {} : rootManifest['importers']['.']?.devDependencies || {}) : rootManifest["packages"][""].devDependencies || {};

	// 统一收集“被子依赖使用”的数据源
	if (!args.pnpm) delete rootManifest["packages"][""];
	let depSource = args.pnpm ? (lockVersion == 6 ? rootManifest.packages || {} : rootManifest.snapshots || {}) : rootManifest["packages"];

	// 记录每个包名→版本 是否被子依赖实际引用（精确到版本）
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
			});
		});
	}

	// 构造结果：先扫描根声明，按“包@版本”粒度占位
	const lockFilePkg: Dependency[] = [];
	const rootDeclared = new Map<string, string>();
	Object.entries({ ...rootProd, ...rootPeer, ...rootOpt, ...rootDev })
		.forEach(([name, ver]) => rootDeclared.set(name, ver as string));
	for (const [name, version] of rootDeclared) {
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
		lockFilePkg.push({
			name,
			type: '',
			version,
			usage: isUsed,
			isDev: Object.prototype.hasOwnProperty.call(rootDev, name)
		});
	}

	// 补充“被子依赖引用过但根未声明”的包
	for (const [name, versions] of usedByOthers) {
		if (!rootDeclared.has(name)) {
			const reprVersion = versions.values().next().value || '';
			lockFilePkg.push({
				name,
				type: 'peer',
				version: reprVersion,
				usage: true,
				isDev: false
			});
		}
	}

	// 按名称排序，确保输出顺序稳定
	lockFilePkg.sort((a, b) => a.name.localeCompare(b.name));
	return lockFilePkg;
}

async function parseDependencies(asts: any[], systemDeps: Dependency[], args: ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	pnpm: boolean;
	silence: boolean;
	ignore: string;
	config: string;
}>) {
	const dependencies: Dependency[] = [];
	for (const ast of asts) {
		traverse(ast, {
			ImportDeclaration: (path: any) => {
				const pkgName = path.node.source.value;
				// 1. 如果 dependencies 中未记录；2. 排除相对路径；3. 仅在 systemDeps 中存在时才记录
				if (!dependencies.some(dep => dep.name === pkgName) && !pkgName.startsWith('.')) {
					const depIndex = systemDeps.findIndex(d => d.name === pkgName);
					if (depIndex !== -1 && systemDeps[depIndex]) {
						systemDeps[depIndex].usage = true;
						systemDeps[depIndex].type = 'import';
					}
					else {
						// 逐级卸载子路径，避免遗漏子包
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
			CallExpression(path: any) {
				const { node } = path;
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
							// 逐级“卸载”子路径，直到匹配到顶层包名
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
			},
			Import(path: any) {
				if (path.node.type === 'Import' && path.node.source?.type === 'StringLiteral') {
					const pkgName = path.node.source.value;
					if (!dependencies.some(dep => dep.name === pkgName) && !pkgName.startsWith('.')) {
						const depIndex = systemDeps.findIndex(d => d.name === pkgName);
						if (depIndex !== -1 && systemDeps[depIndex]) {
							systemDeps[depIndex].usage = true;
							systemDeps[depIndex].type = 'dynamicImport';
						}
						else {
							// 逐级“卸载”子路径，直到匹配到顶层包名
							let target = pkgName;
							while (target.includes('/')) {
								target = target.substring(0, target.lastIndexOf('/'));
								const idx = systemDeps.findIndex(d => d.name === target);
								if (idx !== -1) {
									if (systemDeps[idx]) {
										systemDeps[idx].usage = true;
										systemDeps[idx].type = 'dynamicImport';
									}
									break;
								}
							}
						}
					}
				}
			}
		});
	}

	// 分析额外的忽略项
	// 分析额外的忽略项
	if (args['config'] !== "" || fs.existsSync(`${args.path}/deplens.config.json`)) {
		const configPath = args['config'] || `${args.path}/deplens.config.json`;
		const config = fs.readFileSync(configPath, 'utf8');
		const ignore = JSON.parse(config).ignore || [];
		ignore.forEach((ignore: string) => {
			const depIndex = systemDeps.findIndex(d => d.name === ignore);
			if (depIndex !== -1) {
				if (systemDeps[depIndex]) {
					systemDeps[depIndex].usage = true;
				}
			}
		});
	}
	if (args['ignore'] !== "") {
		const ignoreList = args['ignore'].split(' ');
		ignoreList.forEach((ignore: string) => {
			const depIndex = systemDeps.findIndex(d => d.name === ignore);
			if (depIndex !== -1) {
				if (systemDeps[depIndex]) {
					systemDeps[depIndex].usage = true;
				}
			}
		});
	}
	return true;
}

function summaryData(dependencies: Dependency[]) {
	const totalDepsCount = dependencies.length;
	const usedDepsCount = dependencies.filter(dep => dep.usage).length;
	const unusedDeps = dependencies.filter(dep => !dep.usage && !dep.isDev);
	const devDeps = dependencies.filter(dep => dep.isDev);
	return {
		"usedDependencies": usedDepsCount,
		"unusedDependencies": unusedDeps,
		"ununsedDependenciesCount": unusedDeps.length,
		"totalDependencies": totalDepsCount,
		"devDependencies": devDeps
	} as Result;
}

/**
 * Display analysis results
 * @param options Display options
 */
export function displayResults(result: Result, options: ArgumentsCamelCase<{
	path: string;
	verbose: boolean;
	pnpm: boolean;
	silence: boolean;
}>): void {
	// Default rich output format
	console.log('\n' + chalk.bold.green('✨ Check Results:'));
	console.log(chalk.gray('═'.repeat(50)));

	// TODO: Implement actual results display based on check data
	console.log(chalk.green('✓') + ` Dependency check completed successfully`);
	console.log(chalk.green('✓') + ` Analyzed ${result.totalDependencies} packages`);
	if (result.ununsedDependenciesCount > 0) {
		console.log(chalk.yellow('⚠') + ` Found ${result.ununsedDependenciesCount} unused dependencies : `);
	}
	else {
		console.log(chalk.green('✓') + ` No unused dependencies found`);
	}
	result.unusedDependencies.forEach(dep => {
	  console.log(`   - ${dep.name}`);
	});
	
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
	if(result.unusedDependencies.length > 0 && options["config"] === "" && options["ignore"] === "" && !fs.existsSync(`${options.path}/deplens.config.json`) && !options.silence) {
		console.log(chalk.yellow(`> Due to workload reasons, Deplens cannot fully support all frameworks and plugins.\n> If there are false positives, please record them in deplens.config.json or \'--ignore\' option .`));
	}
	if (options.pnpm) {
		console.log(chalk.cyan('> PNPM support enabled'));
	}
	if (options.verbose) {
		console.log(chalk.cyan('> Verbose output enabled'));
		// TODO: Add verbose output details
	} else if(!options.silence) {
		console.log(chalk.cyan('> Run with --verbose for detailed output'));
	}
}