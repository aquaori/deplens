import { ArgumentsCamelCase } from 'yargs';
import traverse from '@babel/traverse';
import { Dependency, Result } from '../types';
import { getNpmDependencies } from '../driver/npm';
import { getPnpmDependencies } from '../driver/pnpm';
import { resolvePackageManager } from '../driver/package-manager';

export async function getDependencies(args: ArgumentsCamelCase<{
	path: string;
	ignoreDep: string;
	config: string;
}>, checkCount: number) {
	const resolution = resolvePackageManager(args.path);
	if (resolution.manager === 'pnpm') {
		return getPnpmDependencies(args, checkCount);
	}
	return getNpmDependencies(args, checkCount);
}

export async function parseDependencies(asts: any[], systemDeps: Dependency[]) {
	const dependencies: Dependency[] = [];

	for (const ast of asts) {
		traverse(ast, {
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
				else if (
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
				else if (
					(
						node.callee.type === 'Import' || node.callee.name === 'require') &&
					node.arguments[0].type !== 'StringLiteral') {
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
