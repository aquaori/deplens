import chalk from 'chalk';
import readline from 'readline';
import {Signale} from 'signale';

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
 * 日志输出配置对象
 * 包含日志输出配置，如禁用、交互模式、输出流和日志类型
 */
const logOptions = {
  disabled: false,
  interactive: false,
  stream: process.stdout,
  types: {
    secondary: {
      badge: '\t',
      color: 'blue',
      label: ''
    },
  }
};

/**
 * 基于 Signale 的日志实例
 * 用于统一输出各种级别的日志信息
 */
const signale = new Signale(logOptions);

/**
 * 输出 DEBUG 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logDebug(message: string): void {
	signale.debug(message);
}

/**
 * 输出 INFO 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logInfo(message: string): void {
	signale.info(message);
}

/**
 * 输出 WARN 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logWarning(message: string): void {
	signale.warn(message);
}

/**
 * 输出 ERROR 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logError(message: string): void {
	signale.error(message);
}
/**
 * 输出 SUCCESS 级别日志
 * @param message 日志消息内容
 */
export function logSuccess(message: string): void {
	signale.success(message);
}

/**
 * 输出 FATAL 级别日志
 * @param message 日志消息内容
 */
export function logFatal(message: string): void {
	signale.fatal(message);
}

/**
 * 输出 NOTE 级别日志
 * @param message 日志消息内容
 */
export function logNote(message: string): void {
	signale.note(message);
}

/**
 * 输出 PAUSE 级别日志
 * @param message 日志消息内容
 */
export function logPause(message: string): void {
	signale.pause(message);
}

/**
 * 输出 PENDING 级别日志
 * @param message 日志消息内容
 */
export function logPending(message: string): void {
	signale.pending(message);
}

/**
 * 输出 STAR 级别日志（星标）
 * @param message 日志消息内容
 */
export function logStar(message: string): void {
	signale.star(message);
}

/**
 * 输出 START 级别日志
 * @param message 日志消息内容
 */
export function logStart(message: string): void {
	signale.start(message);
}

/**
 * 输出 AWAIT 级别日志
 * @param message 日志消息内容
 */
export function logAwait(message: string): void {
	signale.await(message);
}

/**
 * 输出 WATCH 级别日志
 * @param message 日志消息内容
 */
export function logWatch(message: string): void {
	signale.watch(message);
}

/**
 * 输出 COMPLETE 级别日志
 * @param message 日志消息内容
 */
export function logComplete(message: string): void {
	signale.complete(message);
}

/**
 * 输出 LOG 级别日志
 * @param message 日志消息内容
 */
export function logLog(message: string): void {
	signale.log(message);
}

/**
 * 输出 FAV 级别日志
 * @param message 日志消息内容
 */
export function logFav(message: string): void {
	signale.fav(message);
}

/**
 * 输出 SECONDARY 级别日志
 * @param message 日志消息内容
 */
export function logSecondary(message: string): void {
	signale.secondary(message);
}

/**
 * 自定义输出等级的日志函数
 * @param level signale 支持的日志等级：'await' | 'complete' | 'debug' | 'error' | 'fatal' | 'fav' | 'info' | 'log' | 'note' | 'pause' | 'pending' | 'star' | 'start' | 'success' | 'wait' | 'warn' | 'watch' | 'log'
 * @param message 日志消息内容
 */
export function log(level: keyof typeof signale, message: string): void {
	(signale[level] as any)(message);
}


/**
 * 显示应用 Banner 和基本信息
 */
export function showBanner(): void {
	console.log(DEPLENS_BANNER);
	console.log(chalk.bold.cyan(`Version: ${APP_INFO.version}`));
	console.log(chalk.bold.cyan(`Description: ${APP_INFO.description}\n\n`));
}