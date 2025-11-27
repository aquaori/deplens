#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const cli_utils_1 = require("./cli-utils");
const index_1 = require("./index");
(0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
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
    });
}, async (argv) => {
    if (!argv.silence) {
        (0, cli_utils_1.showBanner)();
        (0, cli_utils_1.logInfo)(`Starting dependency analysis for: ${argv.path}`, cli_utils_1.LogCategory.ANALYSIS);
    }
    try {
        await (0, index_1.analyzeProject)(argv);
    }
    catch (error) {
        console.log("\n");
        (0, cli_utils_1.logError)(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`, cli_utils_1.LogCategory.ANALYSIS);
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
//# sourceMappingURL=cli.js.map