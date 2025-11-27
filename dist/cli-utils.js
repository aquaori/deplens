"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressBarManager = exports.LogCategory = exports.LogLevel = exports.APP_INFO = exports.DEPLENS_BANNER = void 0;
exports.formatLog = formatLog;
exports.log = log;
exports.logDebug = logDebug;
exports.logInfo = logInfo;
exports.logWarning = logWarning;
exports.logError = logError;
exports.showBanner = showBanner;
exports.createProgressBar = createProgressBar;
exports.showProgress = showProgress;
exports.clearProgress = clearProgress;
exports.debug = debug;
exports.info = info;
exports.warn = warn;
exports.error = error;
const chalk_1 = __importDefault(require("chalk"));
const readline_1 = __importDefault(require("readline"));
/**
 * Deplens 应用的 ASCII 艺术 Banner
 * 使用不同颜色显示应用名称
 */
exports.DEPLENS_BANNER = `
  ${chalk_1.default.blueBright('██████╗ ')}${chalk_1.default.greenBright('███████╗')}${chalk_1.default.yellowBright('██████╗ ')}${chalk_1.default.redBright('██╗     ')}${chalk_1.default.cyanBright('███████╗')}${chalk_1.default.magentaBright('███╗   ██╗')}${chalk_1.default.cyanBright('███████╗')}
  ${chalk_1.default.blueBright('██╔══██╗')}${chalk_1.default.greenBright('██╔════╝')}${chalk_1.default.yellowBright('██╔══██╗')}${chalk_1.default.redBright('██║     ')}${chalk_1.default.cyanBright('██╔════╝')}${chalk_1.default.magentaBright('████╗  ██║')}${chalk_1.default.cyanBright('██╔════╝')}
  ${chalk_1.default.blueBright('██║  ██║')}${chalk_1.default.greenBright('█████╗  ')}${chalk_1.default.yellowBright('██████╔╝')}${chalk_1.default.redBright('██║     ')}${chalk_1.default.cyanBright('█████╗  ')}${chalk_1.default.magentaBright('██╔██╗ ██║')}${chalk_1.default.cyanBright('███████╗')}
  ${chalk_1.default.blueBright('██║  ██║')}${chalk_1.default.greenBright('██╔══╝  ')}${chalk_1.default.yellowBright('██╔═══╝ ')}${chalk_1.default.redBright('██║     ')}${chalk_1.default.cyanBright('██╔══╝  ')}${chalk_1.default.magentaBright('██║╚██╗██║')}${chalk_1.default.cyanBright('╚════██║')}
  ${chalk_1.default.blueBright('██████╔╝')}${chalk_1.default.greenBright('███████╗')}${chalk_1.default.yellowBright('██║     ')}${chalk_1.default.redBright('███████╗')}${chalk_1.default.cyanBright('███████╗')}${chalk_1.default.magentaBright('██║ ╚████║')}${chalk_1.default.cyanBright('███████║')}
  ${chalk_1.default.blueBright('╚═════╝ ')}${chalk_1.default.greenBright('╚══════╝')}${chalk_1.default.yellowBright('╚═╝     ')}${chalk_1.default.redBright('╚══════╝')}${chalk_1.default.cyanBright('╚══════╝')}${chalk_1.default.magentaBright('╚═╝  ╚═══╝')}${chalk_1.default.cyanBright('╚══════╝')}
`;
/**
 * 应用信息配置对象
 * 包含版本号、描述和作者信息
 */
exports.APP_INFO = {
    version: '1.0.3',
    description: 'A precise dependency analysis tool for npm and pnpm projects',
    author: 'Deplens Team'
};
/**
 * 日志级别枚举
 * 定义了四种日志级别：DEBUG, INFO, WARN, ERROR
 */
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/**
 * 日志分类枚举
 * 定义了不同的日志分类：通用、文件系统、网络、分析、依赖、配置
 */
var LogCategory;
(function (LogCategory) {
    LogCategory["GENERAL"] = "GENERAL";
    LogCategory["FILE_SYSTEM"] = "FILE_SYSTEM";
    LogCategory["NETWORK"] = "NETWORK";
    LogCategory["ANALYSIS"] = "ANALYSIS";
    LogCategory["DEPENDENCY"] = "DEPENDENCY";
    LogCategory["CONFIG"] = "CONFIG";
})(LogCategory || (exports.LogCategory = LogCategory = {}));
/**
 * 不同日志级别的颜色映射
 */
const logColors = {
    [LogLevel.DEBUG]: chalk_1.default.gray,
    [LogLevel.INFO]: chalk_1.default.blue,
    [LogLevel.WARN]: chalk_1.default.yellow,
    [LogLevel.ERROR]: chalk_1.default.red
};
/**
 * 不同日志级别的表情符号映射
 */
const logEmojis = {
    [LogLevel.DEBUG]: '🐛',
    [LogLevel.INFO]: 'ℹ️',
    [LogLevel.WARN]: '⚠️',
    [LogLevel.ERROR]: '❌'
};
/**
 * 格式化日志消息
 * @param level 日志级别
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 * @returns 格式化后的日志字符串
 */
function formatLog(level, message, category = LogCategory.GENERAL) {
    const timestamp = new Date().toISOString();
    const color = logColors[level];
    const emoji = logEmojis[level];
    const categoryTag = category !== LogCategory.GENERAL ? `[${category}] ` : '';
    return `${chalk_1.default.gray(timestamp)} ${color(level.padEnd(5))} ${emoji} ${categoryTag}${color(message)}`;
}
/**
 * 输出日志到控制台
 * @param level 日志级别
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function log(level, message, category = LogCategory.GENERAL) {
    const formattedMessage = formatLog(level, message, category);
    switch (level) {
        case LogLevel.ERROR:
            console.error(formattedMessage);
            break;
        case LogLevel.WARN:
            console.warn(formattedMessage);
            break;
        default:
            console.log(formattedMessage);
    }
}
/**
 * 输出 DEBUG 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function logDebug(message, category = LogCategory.GENERAL) {
    log(LogLevel.DEBUG, message, category);
}
/**
 * 输出 INFO 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function logInfo(message, category = LogCategory.GENERAL) {
    log(LogLevel.INFO, message, category);
}
/**
 * 输出 WARN 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function logWarning(message, category = LogCategory.GENERAL) {
    log(LogLevel.WARN, message, category);
}
/**
 * 输出 ERROR 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function logError(message, category = LogCategory.GENERAL) {
    log(LogLevel.ERROR, message, category);
}
/**
 * 显示应用 Banner 和基本信息
 */
function showBanner() {
    console.log(exports.DEPLENS_BANNER);
    console.log(chalk_1.default.bold.cyan(`\n  Version: ${exports.APP_INFO.version}`));
    console.log(chalk_1.default.bold.cyan(`  Description: ${exports.APP_INFO.description}\n`));
}
/**
 * 创建进度条字符串
 * @param current 当前进度值
 * @param total 总进度值
 * @param width 进度条宽度（默认为 30）
 * @returns 格式化后的进度条字符串
 */
function createProgressBar(current, total, width = 30) {
    const percentage = Math.round((current / total) * 100);
    const filledWidth = Math.round((current / total) * width);
    const emptyWidth = width - filledWidth;
    const filledBar = chalk_1.default.greenBright('█'.repeat(filledWidth));
    const emptyBar = chalk_1.default.gray('░'.repeat(emptyWidth));
    return `${filledBar}${emptyBar} ${chalk_1.default.yellowBright(percentage + '%')}`;
}
/**
 * 显示进度信息
 * @param message 进度消息
 * @param current 当前进度值
 * @param total 总进度值
 */
function showProgress(message, current, total) {
    const progressBar = createProgressBar(current, total);
    process.stdout.write(`\r${chalk_1.default.blue('→')} ${message} ${progressBar}`);
}
/**
 * 清除进度显示
 */
function clearProgress() {
    process.stdout.write('\r\x1b[K');
}
/**
 * 进度条管理器类
 * 用于创建和管理多个进度条
 */
class ProgressBarManager {
    constructor() {
        this.progressBars = new Map();
    }
    /**
     * 创建一个新的进度条
     * @param name 进度条名称
     * @param totalSteps 总步骤数
     * @param message 进度消息
     * @param width 进度条宽度（默认为 30）
     */
    create(name, totalSteps, message, width = 30) {
        this.progressBars.set(name, {
            name,
            totalSteps,
            currentStep: 0,
            message,
            width
        });
    }
    /**
     * 推进进度条
     * @param name 进度条名称
     * @param steps 前进步骤数（默认为 1）
     */
    advance(name, steps = 1) {
        const progressBar = this.progressBars.get(name);
        if (!progressBar) {
            throw new Error(`Progress bar '${name}' not found`);
        }
        progressBar.currentStep = Math.min(progressBar.currentStep + steps, progressBar.totalSteps);
        this.display(name);
    }
    /**
     * 显示进度条
     * @param name 进度条名称
     */
    display(name) {
        const progressBar = this.progressBars.get(name);
        if (!progressBar) {
            throw new Error(`Progress bar '${name}' not found`);
        }
        const percentage = Math.round((progressBar.currentStep / progressBar.totalSteps) * 100);
        const filledWidth = Math.round((progressBar.currentStep / progressBar.totalSteps) * (progressBar.width || 30));
        const emptyWidth = (progressBar.width || 30) - filledWidth;
        const filledBar = chalk_1.default.greenBright('█'.repeat(filledWidth));
        const emptyBar = chalk_1.default.gray('░'.repeat(emptyWidth));
        const progressBarText = `${chalk_1.default.blue('→')} ${progressBar.message} ${filledBar}${emptyBar} ${chalk_1.default.yellowBright(percentage + '%')}`;
        readline_1.default.cursorTo(process.stdout, 0);
        readline_1.default.clearLine(process.stdout, 0);
        process.stdout.write(progressBarText);
    }
    /**
     * 清除进度条
     * @param name 进度条名称
     */
    clear(name) {
        const progressBar = this.progressBars.get(name);
        if (!progressBar) {
            throw new Error(`Progress bar '${name}' not found`);
        }
        readline_1.default.cursorTo(process.stdout, 0);
        readline_1.default.clearLine(process.stdout, 0);
        this.progressBars.delete(name);
    }
    /**
     * 获取进度百分比
     * @param name 进度条名称
     * @returns 进度百分比
     */
    getProgress(name) {
        const progressBar = this.progressBars.get(name);
        if (!progressBar) {
            throw new Error(`Progress bar '${name}' not found`);
        }
        return Math.round((progressBar.currentStep / progressBar.totalSteps) * 100);
    }
}
/**
 * 全局进度条管理器实例
 */
exports.progressBarManager = new ProgressBarManager();
/**
 * 输出 DEBUG 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function debug(message, category = LogCategory.GENERAL) {
    logDebug(message, category);
}
/**
 * 输出 INFO 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function info(message, category = LogCategory.GENERAL) {
    logInfo(message, category);
}
/**
 * 输出 WARN 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function warn(message, category = LogCategory.GENERAL) {
    logWarning(message, category);
}
/**
 * 输出 ERROR 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
function error(message, category = LogCategory.GENERAL) {
    logError(message, category);
}
//# sourceMappingURL=cli-utils.js.map