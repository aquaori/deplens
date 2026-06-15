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
	version: '1.2.4',
	description: 'A precise dependency analysis tool for npm and pnpm projects',
	author: 'Deplens Team'
};

type LogLevel =
	| 'debug'
	| 'info'
	| 'warn'
	| 'error'
	| 'success'
	| 'fatal'
	| 'note'
	| 'pause'
	| 'pending'
	| 'star'
	| 'start'
	| 'await'
	| 'watch'
	| 'complete'
	| 'log'
	| 'fav'
	| 'secondary';

const levelStyles: Record<LogLevel, (text: string) => string> = {
	debug: chalk.gray,
	info: chalk.cyan,
	warn: chalk.yellow,
	error: chalk.red,
	success: chalk.green,
	fatal: chalk.redBright,
	note: chalk.blueBright,
	pause: chalk.yellowBright,
	pending: chalk.magentaBright,
	star: chalk.yellowBright,
	start: chalk.cyanBright,
	await: chalk.blue,
	watch: chalk.cyanBright,
	complete: chalk.greenBright,
	log: (text: string) => text,
	fav: chalk.magenta,
	secondary: chalk.blue,
};

const levelPrefixes: Record<LogLevel, string> = {
	debug: 'debug',
	info: 'info',
	warn: 'warn',
	error: 'error',
	success: 'success',
	fatal: 'fatal',
	note: 'note',
	pause: 'pause',
	pending: 'pending',
	star: 'star',
	start: 'start',
	await: 'await',
	watch: 'watch',
	complete: 'complete',
	log: 'log',
	fav: 'fav',
	secondary: '',
};

function emit(level: LogLevel, message: string): void {
	if (level === 'secondary') {
		console.log(levelStyles.secondary(`\t${message}`));
		return;
	}

	const prefix = levelPrefixes[level];
	const style = levelStyles[level];
	console.log(style(prefix ? `[${prefix}] ${message}` : message));
}

/**
 * 输出 DEBUG 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logDebug(message: string): void {
	emit('debug', message);
}

/**
 * 输出 INFO 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logInfo(message: string): void {
	emit('info', message);
}

/**
 * 输出 WARN 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logWarning(message: string): void {
	emit('warn', message);
}

/**
 * 输出 ERROR 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export function logError(message: string): void {
	emit('error', message);
}
/**
 * 输出 SUCCESS 级别日志
 * @param message 日志消息内容
 */
export function logSuccess(message: string): void {
	emit('success', message);
}

/**
 * 输出 FATAL 级别日志
 * @param message 日志消息内容
 */
export function logFatal(message: string): void {
	emit('fatal', message);
}

/**
 * 输出 NOTE 级别日志
 * @param message 日志消息内容
 */
export function logNote(message: string): void {
	emit('note', message);
}

/**
 * 输出 PAUSE 级别日志
 * @param message 日志消息内容
 */
export function logPause(message: string): void {
	emit('pause', message);
}

/**
 * 输出 PENDING 级别日志
 * @param message 日志消息内容
 */
export function logPending(message: string): void {
	emit('pending', message);
}

/**
 * 输出 STAR 级别日志（星标）
 * @param message 日志消息内容
 */
export function logStar(message: string): void {
	emit('star', message);
}

/**
 * 输出 START 级别日志
 * @param message 日志消息内容
 */
export function logStart(message: string): void {
	emit('start', message);
}

/**
 * 输出 AWAIT 级别日志
 * @param message 日志消息内容
 */
export function logAwait(message: string): void {
	emit('await', message);
}

/**
 * 输出 WATCH 级别日志
 * @param message 日志消息内容
 */
export function logWatch(message: string): void {
	emit('watch', message);
}

/**
 * 输出 COMPLETE 级别日志
 * @param message 日志消息内容
 */
export function logComplete(message: string): void {
	emit('complete', message);
}

/**
 * 输出 LOG 级别日志
 * @param message 日志消息内容
 */
export function logLog(message: string): void {
	emit('log', message);
}

/**
 * 输出 FAV 级别日志
 * @param message 日志消息内容
 */
export function logFav(message: string): void {
	emit('fav', message);
}

/**
 * 输出 SECONDARY 级别日志
 * @param message 日志消息内容
 */
export function logSecondary(message: string): void {
	emit('secondary', message);
}

/**
 * 自定义输出等级的日志函数
 * @param level signale 支持的日志等级：'await' | 'complete' | 'debug' | 'error' | 'fatal' | 'fav' | 'info' | 'log' | 'note' | 'pause' | 'pending' | 'star' | 'start' | 'success' | 'wait' | 'warn' | 'watch' | 'log'
 * @param message 日志消息内容
 */
export function log(level: LogLevel, message: string): void {
	emit(level, message);
}


/**
 * 显示应用 Banner 和基本信息
 */
export function showBanner(): void {
	console.log(DEPLENS_BANNER);
	console.log(chalk.bold.cyan(`Version: ${APP_INFO.version}`));
	console.log(chalk.bold.cyan(`Description: ${APP_INFO.description}\n\n`));
}
