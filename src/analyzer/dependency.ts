import { ArgumentsCamelCase } from 'yargs';
import traverse from '@babel/traverse';
import { Dependency, Result } from '../types';
import { getNpmDependencies } from '../driver/npm';
import { getPnpmDependencies } from '../driver/pnpm';

/**
 * 获取项目的依赖信息
 * @param args 命令行参数对象
 * @returns 依赖列表
 */
export async function getDependencies(args: ArgumentsCamelCase<{
	path: string;
	pnpm: boolean;
	ignoreDep: string;
	config: string;
}>, checkCount: number) {
	// 根据包管理器类型调用相应的依赖获取函数
	if (args.pnpm) {
		return getPnpmDependencies(args, checkCount);
	} else {
		return getNpmDependencies(args, checkCount);
	}
}

/**
 * 解析依赖使用情况
 * @param asts AST 列表
 * @param systemDeps 系统依赖列表
 * @param args 命令行参数对象
 * @returns 解析结果
 */
export async function parseDependencies(asts: any[], systemDeps: Dependency[]) {
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
export function summaryData(dependencies: Dependency[], checkCount: number) {
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