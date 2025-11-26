import chalk from 'chalk';
import readline from 'readline';

/**
 * Deplens 应用的 ASCII 艺术 Banner
 * 使用不同颜色显示应用名称
 */
export const DEPLENS_BANNER = `
  ${chalk.blueBright('██████╗ ')}${chalk.greenBright('███████╗')}${chalk.yellowBright('██████╗ ')}${chalk.redBright('██╗     ')}${chalk.cyanBright('███████╗')}${chalk.magentaBright('███╗   ██╗')}${chalk.cyanBright('███████╗')}
  ${chalk.blueBright('██╔══██╗')}${chalk.greenBright('██╔════╝')}${chalk.yellowBright('██╔══██╗')}${chalk.redBright('██║     ')}${chalk.cyanBright('██╔════╝')}${chalk.magentaBright('████╗  ██║')}${chalk.cyanBright('██╔════╝')}
  ${chalk.blueBright('██║  ██║')}${chalk.greenBright('█████╗  ')}${chalk.yellowBright('██████╔╝')}${chalk.redBright('██║     ')}${chalk.cyanBright('█████╗  ')}${chalk.magentaBright('██╔██╗ ██║')}${chalk.cyanBright('███████╗')}
  ${chalk.blueBright('██║  ██║')}${chalk.greenBright('██╔══╝  ')}${chalk.yellowBright('██╔═══╝ ')}${chalk.redBright('██║     ')}${chalk.cyanBright('██╔══╝  ')}${chalk.magentaBright('██║╚██╗██║')}${chalk.cyanBright('╚════██║')}
  ${chalk.blueBright('██████╔╝')}${chalk.greenBright('███████╗')}${chalk.yellowBright('██║     ')}${chalk.redBright('███████╗')}${chalk.cyanBright('███████╗')}${chalk.magentaBright('██║ ╚████║')}${chalk.cyanBright('███████║')}
  ${chalk.blueBright('╚═════╝ ')}${chalk.greenBright('╚══════╝')}${chalk.yellowBright('╚═╝     ')}${chalk.redBright('╚══════╝')}${chalk.cyanBright('╚══════╝')}${chalk.magentaBright('╚═╝  ╚═══╝')}${chalk.cyanBright('╚══════╝')}
`

/**
 * 应用信息配置对象
 * 包含版本号、描述和作者信息
 */
export const APP_INFO = {
	version: '1.0.3',
	description: 'A precise dependency analysis tool for npm and pnpm projects',
	author: 'Deplens Team'
};

/**
 * 日志级别枚举
 * 定义了四种日志级别：DEBUG, INFO, WARN, ERROR
 */
export enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR'
}

/**
 * 日志分类枚举
 * 定义了不同的日志分类：通用、文件系统、网络、分析、依赖、配置
 */
export enum LogCategory {
	GENERAL = 'GENERAL',
	FILE_SYSTEM = 'FILE_SYSTEM',
	NETWORK = 'NETWORK',
	ANALYSIS = 'ANALYSIS',
	DEPENDENCY = 'DEPENDENCY',
	CONFIG = 'CONFIG'
}

/**
 * 不同日志级别的颜色映射
 */
const logColors = {
	[LogLevel.DEBUG]: chalk.gray,
	[LogLevel.INFO]: chalk.blue,
	[LogLevel.WARN]: chalk.yellow,
	[LogLevel.ERROR]: chalk.red
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
export function formatLog(level: LogLevel, message: string, category: LogCategory = LogCategory.GENERAL): string {
	const timestamp = new Date().toISOString();
	const color = logColors[level];
	const emoji = logEmojis[level];
	const categoryTag = category !== LogCategory.GENERAL ? `[${category}] ` : '';
	return `${chalk.gray(timestamp)} ${color(level.padEnd(5))} ${emoji} ${categoryTag}${color(message)}`;
}

/**
 * 输出日志到控制台
 * @param level 日志级别
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function log(level: LogLevel, message: string, category: LogCategory = LogCategory.GENERAL): void {
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
export function logDebug(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.DEBUG, message, category);
}

/**
 * 输出 INFO 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logInfo(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.INFO, message, category);
}

/**
 * 输出 WARN 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logWarning(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.WARN, message, category);
}

/**
 * 输出 ERROR 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logError(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.ERROR, message, category);
}

/**
 * 显示应用 Banner 和基本信息
 */
export function showBanner(): void {
	console.log(DEPLENS_BANNER);
	console.log(chalk.bold.cyan(`\n  Version: ${APP_INFO.version}`));
	console.log(chalk.bold.cyan(`  Description: ${APP_INFO.description}\n`));
}

/**
 * 创建进度条字符串
 * @param current 当前进度值
 * @param total 总进度值
 * @param width 进度条宽度（默认为 30）
 * @returns 格式化后的进度条字符串
 */
export function createProgressBar(current: number, total: number, width: number = 30): string {
	const percentage = Math.round((current / total) * 100);
	const filledWidth = Math.round((current / total) * width);
	const emptyWidth = width - filledWidth;

	const filledBar = chalk.greenBright('█'.repeat(filledWidth));
	const emptyBar = chalk.gray('░'.repeat(emptyWidth));

	return `${filledBar}${emptyBar} ${chalk.yellowBright(percentage + '%' )}`;
}

/**
 * 显示进度信息
 * @param message 进度消息
 * @param current 当前进度值
 * @param total 总进度值
 */
export function showProgress(message: string, current: number, total: number): void {
	const progressBar = createProgressBar(current, total);
	process.stdout.write(`\r${chalk.blue('→')} ${message} ${progressBar}`);
}

/**
 * 清除进度显示
 */
export function clearProgress(): void {
	process.stdout.write('\r\x1b[K');
}

/**
 * 进度条配置接口
 */
interface ProgressBarConfig {
	name: string;
	totalSteps: number;
	currentStep: number;
	message: string;
	width?: number;
}

/**
 * 进度条管理器类
 * 用于创建和管理多个进度条
 */
class ProgressBarManager {
	private progressBars: Map<string, ProgressBarConfig> = new Map();

	/**
	 * 创建一个新的进度条
	 * @param name 进度条名称
	 * @param totalSteps 总步骤数
	 * @param message 进度消息
	 * @param width 进度条宽度（默认为 30）
	 */
	create(name: string, totalSteps: number, message: string, width: number = 30): void {
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
	advance(name: string, steps: number = 1): void {
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
	private display(name: string): void {
		const progressBar = this.progressBars.get(name);
		if (!progressBar) {
			throw new Error(`Progress bar '${name}' not found`);
		}

		const percentage = Math.round((progressBar.currentStep / progressBar.totalSteps) * 100);
		const filledWidth = Math.round((progressBar.currentStep / progressBar.totalSteps) * (progressBar.width || 30));
		const emptyWidth = (progressBar.width || 30) - filledWidth;

		const filledBar = chalk.greenBright('█'.repeat(filledWidth));
		const emptyBar = chalk.gray('░'.repeat(emptyWidth));

		const progressBarText = `${chalk.blue('→')} ${progressBar.message} ${filledBar}${emptyBar} ${chalk.yellowBright(percentage + '%' )}`;
		readline.cursorTo(process.stdout, 0);
		readline.clearLine(process.stdout, 0);
		process.stdout.write(progressBarText);
	}

	/**
	 * 清除进度条
	 * @param name 进度条名称
	 */
	clear(name: string): void {
		const progressBar = this.progressBars.get(name);
		if (!progressBar) {
			throw new Error(`Progress bar '${name}' not found`);
		}

		readline.cursorTo(process.stdout, 0);
		readline.clearLine(process.stdout, 0);
		this.progressBars.delete(name);
	}

	/**
	 * 获取进度百分比
	 * @param name 进度条名称
	 * @returns 进度百分比
	 */
	getProgress(name: string): number {
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
export const progressBarManager = new ProgressBarManager();

/**
 * 输出 DEBUG 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function debug(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logDebug(message, category);
}

/**
 * 输出 INFO 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function info(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logInfo(message, category);
}

/**
 * 输出 WARN 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function warn(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logWarning(message, category);
}

/**
 * 输出 ERROR 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function error(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logError(message, category);
}