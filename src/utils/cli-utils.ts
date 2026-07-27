import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const PACKAGE_NAME = '@aquaori/deplens';

/**
 * 从自身的 package.json 读取版本号。
 * src 下 __dirname 为 <root>/src/utils，dist 下为 <root>/dist/utils，两者的 ../../package.json 都指向仓库根。
 * 校验 name 字段可避免在异常布局下误读到调用方项目的 package.json。
 */
function resolveAppVersion(): string {
	const candidates = [
		path.join(__dirname, '..', '..', 'package.json'),
		path.join(__dirname, '..', 'package.json'),
	];

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
				name?: string;
				version?: string;
			};
			if (parsed.name === PACKAGE_NAME && typeof parsed.version === 'string') {
				return parsed.version;
			}
		} catch {
			// 尝试下一个候选路径
		}
	}

	return '0.0.0';
}

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
	version: resolveAppVersion(),
	description: 'A precise dependency analysis tool for npm and pnpm projects',
	author: 'Deplens Team'
};

type LogLevel = 'info' | 'warn' | 'success' | 'fatal' | 'secondary';

const levelStyles: Record<LogLevel, (text: string) => string> = {
	info: chalk.cyan,
	warn: chalk.yellow,
	success: chalk.green,
	fatal: chalk.redBright,
	secondary: chalk.blue,
};

const levelPrefixes: Record<LogLevel, string> = {
	info: 'info',
	warn: 'warn',
	success: 'success',
	fatal: 'fatal',
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
 * 输出 SECONDARY 级别日志
 * @param message 日志消息内容
 */
export function logSecondary(message: string): void {
	emit('secondary', message);
}

/**
 * 显示应用 Banner 和基本信息
 */
export function showBanner(): void {
	console.log(DEPLENS_BANNER);
	console.log(chalk.bold.cyan(`Version: ${APP_INFO.version}`));
	console.log(chalk.bold.cyan(`Description: ${APP_INFO.description}\n\n`));
}
