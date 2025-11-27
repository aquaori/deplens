import { logInfo, logSuccess, logWarning, logSecondary } from '../utils/cli-utils';
import chalk from 'chalk';
import fs from 'fs';
import { ArgumentsCamelCase } from 'yargs';
import { Dependency, Result } from '../types';
import { scan } from '../analyzer/scanner';
import { parseAST } from '../analyzer/parser';
import { getDependencies, parseDependencies, summaryData } from '../analyzer/dependency';
import cliProgress from 'cli-progress';
import { spitOutQueue } from '../utils/logQueue';

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
	let bar1: cliProgress.SingleBar | null = null;
	if (!args.silence) {
		bar1 = new cliProgress.SingleBar({
			clearOnComplete: true,
			hideCursor: true,
			format: ' {bar} | {stepname} | {value}/{total}',
		}, cliProgress.Presets.shades_classic);
		bar1.start(4, 0, { stepname: 'Initializing...' });
	}

	const fileContentList = await scan(args);
	if (!args.silence && bar1) bar1.increment({ stepname: 'Scanning files' });

	const astList = await parseAST(fileContentList as string[]);
	if (!args.silence && bar1) bar1.increment({ stepname: 'Parsing AST' });

	const [systemDeps, checkCount] = await getDependencies(args, 0);
	await parseDependencies(astList, systemDeps as Dependency[]);
	if (!args.silence && bar1) bar1.increment({ stepname: 'Analyzing dependencies' });

	const summary = summaryData(systemDeps as Dependency[], checkCount as number) as Result;
	if (!args.silence && bar1) bar1.increment({ stepname: 'Summarizing results' });

	
	if (!args.silence && bar1) {
		bar1.stop();
		spitOutQueue();
	}

	logSuccess(` Dependencies checking Successfully`);

	displayResults(summary, args);
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
	logSuccess(` Dependency check completed successfully`);
	logSuccess(` Analyzed ${result.totalDependencies} packages`);
	
	if (result.ununsedDependenciesCount > 0) {
		logInfo(` Found ${result.ununsedDependenciesCount} unused dependencies : `);
	}
	else {
		logSuccess(` No unused dependencies found`);
	}
	
	let hasDynamic = false;
	result.unusedDependencies.forEach(dep => {
		if(dep.type !== 'dynamic' && !dep.args) logSecondary(`\t- ${dep.name}${dep.version ? ` @${(dep.version as any).join(' & @')}` : ''}`);
		else hasDynamic = true;
	});
	
	if(hasDynamic) {
		logInfo(` Found ${result.unusedDependencies.filter(dep => dep.type === 'dynamic').length} dynamic imports that deplens cannot analyze: `);
		result.unusedDependencies.filter(dep => dep.type === 'dynamic').forEach(dep => {
			logSecondary(`\t- ${dep.args}`);
		});
	}

	// 如果启用了详细输出，显示开发依赖信息
	if (options.verbose) {
		if (result.devDependencies.length > 0) {
			logInfo(` Found ${result.devDependencies.length} dev dependencies that you maybe don't need them in stable environment : `);
		}
		else {
			logSuccess(` No dev dependencies found`);
		}
		result.devDependencies.forEach(dep => {
			logSecondary(`\t- ${dep.name}`);
		});
	}

	console.log('\n' + chalk.bold.green('⚠️  Some extra info:'));
	console.log(chalk.gray('═'.repeat(50)));
	
	// 提示用户如何处理误报
		if(result.ununsedDependenciesCount > 0 && options["config"] === "" && (options["ignoreDep"] === "" || options["ignorePath"] === "" || options["ignoreFile"] === "") && !fs.existsSync(`${options.path}/deplens.config.json`) && !options.silence) {
			logWarning(` Due to workload reasons, Deplens cannot fully support all frameworks and plugins.`);
			logWarning(` If there are false positives, please record them in [ deplens.config.json ] or \'--ignore\' option .`);
		}
	
	// 显示启用的选项信息
	if (options.pnpm) {
		logInfo(` PNPM support enabled`);
	}
	
	if (options.verbose) {
		logInfo(` Verbose output enabled`);
	} else if(!options.silence) {
		logInfo(` Run with --verbose for detailed output`);
	}
}