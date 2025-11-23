#!/usr/bin/env node

/**
 * Deplens CLI
 */

import yargs, { ArgumentsCamelCase } from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
	showBanner,
	logInfo,
	logError,
	LogCategory
} from './cli-utils';
import { analyzeProject } from './index';

// CLI argument parsing with yargs
yargs(hideBin(process.argv))
	.scriptName('deplens')
	.usage('Usage: $0 <command> [options]')
	.command('check', 'Check project dependencies', (yargs) => {
		return yargs
			.option('path', {
				alias: 'p',
				type: 'string',
				description: 'Path to check (defaults to current directory)',
				default: process.cwd()
			})
			.option('verbose', {
				alias: 'V',
				type: 'boolean',
				description: 'Enable verbose output',
				default: false
			})
			.option('pnpm', {
				alias: 'pn',
				type: 'boolean',
				description: 'Enable pnpm support',
				default: false
			})
			.option('ignore', {
				alias: 'i',
				type: 'string',
				description: 'Ignore files',
				default: ''
			})
			.option('config', {
				alias: 'c',
				type: 'string',
				description: 'Path of config file',
				default: ''
			})
			.option('silence', {
				alias: 's',
				type: 'boolean',
				description: 'Silence output',
				default: false
			});
	}, async (argv) => {
		if (!argv.silence) {
			// Show banner on startup
			showBanner();
			logInfo(`Starting dependency analysis for: ${argv.path}`, LogCategory.ANALYSIS);
		}
		try {
			// Perform actual analysis
			await analyzeProject(argv as ArgumentsCamelCase<{
				path: string;
				verbose: boolean;
				pnpm: boolean;
				silence: boolean;
				ignore: string;
				config: string;
			}>);

		} catch (error) {
			console.log("\n")
			// console.log(error)
			logError(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`, LogCategory.ANALYSIS);
			process.exit(1);
		}
	})
	.help()
	.alias('help', 'h')
	.version()
	.alias('version', 'v')
	.demandCommand(1, 'You need at least one command before moving on')
	.recommendCommands()
	.strict()
	.argv;