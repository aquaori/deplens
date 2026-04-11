#!/usr/bin/env node

import yargs, { ArgumentsCamelCase } from 'yargs';
import { hideBin } from 'yargs/helpers';
import cliProgress from 'cli-progress';
import {
	showBanner,
	logInfo,
	logFatal,
	logWarning,
	logSuccess,
} from './utils/cli-utils';
import { analyzeProject } from './index';
import { startInteractiveReviewSession } from './agent/ui';
import { renderAnalysisReport, renderCheckReviewHints, renderProjectAnalysisReport, renderProjectExtraInfo } from './report/renderers';
import { outputJsonReport } from './report/output';
import { ensureReviewAiConfig, prepareReviewEnhancement } from './agent/base';
import { getDependencyReviewCandidates } from './query';
import {
	getUserConfigEntries,
	getUserConfigFilePath,
	getUserConfigValue,
	maskConfigValue,
	normalizeCliConfigKey,
	resetUserConfig,
	setUserConfigValue,
	unsetUserConfigValue,
} from './config/runtime';

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
			.option('ignoreDep', {
				alias: 'id',
				type: 'string',
				description: 'Ignore dependencies',
				default: ''
			})
			.option('ignorePath', {
				alias: 'ip',
				type: 'string',
				description: 'Ignore paths',
				default: ''
			})
			.option('ignoreFile', {
				alias: 'if',
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
			})
			.option('html', {
				alias: 'H',
				type: 'boolean',
				description: 'Generate HTML report',
				default: false
			})
			.option('json', {
				alias: 'J',
				type: 'boolean',
				description: 'Generate JSON report',
				default: false
			})
			.option('output', {
				alias: 'o',
				type: 'string',
				description: 'Output path for generated report',
				default: ''
			})
			.option('preReview', {
				type: 'boolean',
				description: 'Run AI second-pass review for low-confidence dependency candidates',
				default: false
			});
	}, async (argv) => {
		if (argv.json) {
			argv.silence = true;
		}
		if (!argv.silence) {
			showBanner();
			logInfo(` Starting dependency analysis for: ${argv.path}`);
		}
		try {
			const analyzeArgs = argv as ArgumentsCamelCase<{
				path: string;
				verbose: boolean;
				silence: boolean;
				ignoreDep: string;
				ignorePath: string;
				ignoreFile: string;
				config: string;
				html: boolean;
				json: boolean;
				output: string;
				preReview?: boolean;
			}>;
			const report = await analyzeProject(analyzeArgs, false);

			if (Array.isArray(report)) {
				process.exit(0);
			}

			if (argv.json) {
				if (argv.preReview && !argv.silence) {
					logWarning(` AI pre-review results are not included in the current JSON report schema; only the base analysis report will be written.`);
				}
				outputJsonReport(report, analyzeArgs);
				process.exit(0);
			}
			let enhancementSummary:
				| {
					reviewedCandidateCount: number;
					confirmedUsedCount: number;
					likelyToolingUsageCount: number;
					needsReviewCount: number;
				}
				| undefined;
			let reviewedCandidates: any[] = [];
			if (argv.preReview) {
				ensureReviewAiConfig();
				const reviewCandidates = getDependencyReviewCandidates(report).filter((candidate) =>
					candidate.disposition === "needs-review"
					|| candidate.disposition === "likely-tooling-usage"
				);

				if (!argv.silence && reviewCandidates.length > 0) {
					const reviewBar = new cliProgress.SingleBar(
						{
							clearOnComplete: true,
							hideCursor: true,
							format: " {bar} | {stepname} | {value}/{total}",
						},
						cliProgress.Presets.shades_classic
					);
					reviewBar.start(reviewCandidates.length, 0, { stepname: "AI pre-review" });
					const enhancement = await prepareReviewEnhancement(report, (current, total, candidate) => {
						reviewBar.setTotal(total);
						reviewBar.update(current, { stepname: `Reviewing ${candidate.dependencyName}` });
					});
					reviewBar.stop();
					enhancementSummary = enhancement.summary;
					reviewedCandidates = Array.from(enhancement.reviewedByKey.values());
				} else if (reviewCandidates.length > 0) {
					const enhancement = await prepareReviewEnhancement(report);
					enhancementSummary = enhancement.summary;
					reviewedCandidates = Array.from(enhancement.reviewedByKey.values());
				} else {
					enhancementSummary = {
						reviewedCandidateCount: 0,
						confirmedUsedCount: 0,
						likelyToolingUsageCount: 0,
						needsReviewCount: 0,
					};
				}
			}

			if (report.kind === "project") {
				renderProjectAnalysisReport(report, analyzeArgs, reviewedCandidates, false);
				renderCheckReviewHints(report, enhancementSummary, reviewedCandidates);
				renderProjectExtraInfo(report, analyzeArgs);
			} else {
				renderAnalysisReport(report, analyzeArgs);
				renderCheckReviewHints(report, enhancementSummary, reviewedCandidates);
			}
			process.exit(0);

		} catch (error) {
			console.log("\n")
			logFatal(` Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	})
	.command(
		'review [question]',
		'Ask the review agent a question',
		(yargs) => {
			return yargs
				.positional('question', {
					type: 'string',
					describe: 'Question for the agent',
					default: '',
				})
				.option('path', {
					alias: 'p',
					type: 'string',
					description: 'Path to analyze before starting review',
					default: process.cwd()
				})
				.option('verbose', {
					alias: 'V',
					type: 'boolean',
					description: 'Enable verbose output',
					default: false
				})
				.option('ignoreDep', {
					alias: 'id',
					type: 'string',
					description: 'Ignore dependencies',
					default: ''
				})
				.option('ignorePath', {
					alias: 'ip',
					type: 'string',
					description: 'Ignore paths',
					default: ''
				})
				.option('ignoreFile', {
					alias: 'if',
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
					description: 'Silence analysis output',
					default: false
				})
				.option('html', {
					alias: 'H',
					type: 'boolean',
					description: 'Generate HTML report',
					default: false
				})
				.option('json', {
					alias: 'J',
					type: 'boolean',
					description: 'Generate JSON report',
					default: false
				})
				.option('output', {
					alias: 'o',
					type: 'string',
					description: 'Output path for generated report',
					default: ''
				})
				.option('preReview', {
					type: 'boolean',
					description: 'Run AI pre-review for low-confidence dependency candidates before opening the review session',
					default: false
				});
		},
		async (argv) => {
			try {
				await startInteractiveReviewSession(
					argv as ArgumentsCamelCase<{
						path: string;
						verbose: boolean;
						silence: boolean;
						ignoreDep: string;
						ignorePath: string;
						ignoreFile: string;
						config: string;
						html: boolean;
						json: boolean;
						output: string;
						preReview?: boolean;
					}>,
					argv.question as string
				);
				process.exit(0);
			} catch (error) {
				logFatal(` Review failed: ${error instanceof Error ? error.message : String(error)}`);
				process.exit(1);
			}
		}
	)
	.command(
		'config <action> [key] [value]',
		'Manage persistent AI configuration stored in the user profile',
		(yargs) => {
			return yargs
				.positional('action', {
					type: 'string',
					describe: 'Config action',
					choices: ['set', 'get', 'list', 'unset', 'reset', 'path'] as const,
				})
				.positional('key', {
					type: 'string',
					describe: 'Config key: apiKey | baseUrl | model',
				})
				.positional('value', {
					type: 'string',
					describe: 'Config value used by the set action',
				})
				.example('$0 config set apiKey sk-xxx', 'Persist the AI API key in the user config file')
				.example('$0 config set baseUrl https://dashscope.aliyuncs.com/compatible-mode/v1', 'Persist the AI base URL in the user config file')
				.example('$0 config list', 'List the current persisted AI configuration')
				.example('$0 config reset', 'Remove all persisted AI configuration');
		},
		async (argv) => {
			try {
				const action = String(argv.action || '');
				const rawKey = argv.key ? String(argv.key) : '';
				const normalizedKey = rawKey ? normalizeCliConfigKey(rawKey) : null;

				if ((action === 'set' || action === 'get' || action === 'unset') && !normalizedKey) {
					throw new Error(`Unknown config key: ${rawKey}. Supported keys: apiKey, baseUrl, model.`);
				}

				switch (action) {
					case 'set': {
						const rawValue = argv.value ? String(argv.value) : '';
						if (rawValue.trim() === '') {
							throw new Error('The set action requires a non-empty value.');
						}
						setUserConfigValue(normalizedKey!, rawValue);
						logSuccess(` Saved ${normalizedKey} to user config: ${getUserConfigFilePath()}`);
						break;
					}
					case 'get': {
						const value = getUserConfigValue(normalizedKey!);
						if (!value) {
							logWarning(` ${normalizedKey} is not set in user config.`);
							process.exit(1);
						}
						console.log(value);
						break;
					}
					case 'list': {
						logInfo(` User config path: ${getUserConfigFilePath()}`);
						for (const entry of getUserConfigEntries()) {
							console.log(`${entry.key}=${maskConfigValue(entry.key, entry.value)}`);
						}
						break;
					}
					case 'unset': {
						unsetUserConfigValue(normalizedKey!);
						logSuccess(` Removed ${normalizedKey} from user config.`);
						break;
					}
					case 'reset': {
						resetUserConfig();
						logSuccess(' Removed all persisted AI configuration.');
						break;
					}
					case 'path': {
						console.log(getUserConfigFilePath());
						break;
					}
					default:
						throw new Error(`Unsupported config action: ${action}`);
				}

				process.exit(0);
			} catch (error) {
				logFatal(` Config command failed: ${error instanceof Error ? error.message : String(error)}`);
				process.exit(1);
			}
		}
	)
	.help()
	.alias('help', 'h')
	.version()
	.alias('version', 'v')
	.demandCommand(1, 'You need at least one command before moving on')
	.recommendCommands()
	.strict()
	.argv;
