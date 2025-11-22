import chalk from 'chalk';
import readline from 'readline';

// ASCII Art for the application name
export const DEPLENS_BANNER = `
  ${chalk.blueBright('██████╗ ')}${chalk.greenBright('███████╗')}${chalk.yellowBright('██████╗ ')}${chalk.redBright('██╗     ')}${chalk.cyanBright('███████╗')}${chalk.magentaBright('███╗   ██╗')}${chalk.cyanBright('███████╗')}
  ${chalk.blueBright('██╔══██╗')}${chalk.greenBright('██╔════╝')}${chalk.yellowBright('██╔══██╗')}${chalk.redBright('██║     ')}${chalk.cyanBright('██╔════╝')}${chalk.magentaBright('████╗  ██║')}${chalk.cyanBright('██╔════╝')}
  ${chalk.blueBright('██║  ██║')}${chalk.greenBright('█████╗  ')}${chalk.yellowBright('██████╔╝')}${chalk.redBright('██║     ')}${chalk.cyanBright('█████╗  ')}${chalk.magentaBright('██╔██╗ ██║')}${chalk.cyanBright('███████╗')}
  ${chalk.blueBright('██║  ██║')}${chalk.greenBright('██╔══╝  ')}${chalk.yellowBright('██╔═══╝ ')}${chalk.redBright('██║     ')}${chalk.cyanBright('██╔══╝  ')}${chalk.magentaBright('██║╚██╗██║')}${chalk.cyanBright('╚════██║')}
  ${chalk.blueBright('██████╔╝')}${chalk.greenBright('███████╗')}${chalk.yellowBright('██║     ')}${chalk.redBright('███████╗')}${chalk.cyanBright('███████╗')}${chalk.magentaBright('██║ ╚████║')}${chalk.cyanBright('███████║')}
  ${chalk.blueBright('╚═════╝ ')}${chalk.greenBright('╚══════╝')}${chalk.yellowBright('╚═╝     ')}${chalk.redBright('╚══════╝')}${chalk.cyanBright('╚══════╝')}${chalk.magentaBright('╚═╝  ╚═══╝')}${chalk.cyanBright('╚══════╝')}
`
// Appicatin info
export const APP_INFO = {
	version: '1.0.0',
	description: 'A precise dependency analysis tool for npm and pnpm projects',
	author: 'Deplens Team'
};

// Log levels
export enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR'
}

// Log categories
export enum LogCategory {
	GENERAL = 'GENERAL',
	FILE_SYSTEM = 'FILE_SYSTEM',
	NETWORK = 'NETWORK',
	ANALYSIS = 'ANALYSIS',
	DEPENDENCY = 'DEPENDENCY',
	CONFIG = 'CONFIG'
}

// Color mapping for log levels
const logColors = {
	[LogLevel.DEBUG]: chalk.gray,
	[LogLevel.INFO]: chalk.blue,
	[LogLevel.WARN]: chalk.yellow,
	[LogLevel.ERROR]: chalk.red
};

// Emoji mapping for log levels
const logEmojis = {
	[LogLevel.DEBUG]: '🐛',
	[LogLevel.INFO]: 'ℹ️',
	[LogLevel.WARN]: '⚠️',
	[LogLevel.ERROR]: '❌'
};

/**
 * Format a log message with timestamp, level, and emoji
 * @param level Log level
 * @param message Log message
 * @param category Log category
 * @returns Formatted log string
 */
export function formatLog(level: LogLevel, message: string, category: LogCategory = LogCategory.GENERAL): string {
	const timestamp = new Date().toISOString();
	const color = logColors[level];
	const emoji = logEmojis[level];
	const categoryTag = category !== LogCategory.GENERAL ? `[${category}] ` : '';
	return `${chalk.gray(timestamp)} ${color(level.padEnd(5))} ${emoji} ${categoryTag}${color(message)}`;
}

/**
 * Generic log function
 * @param level Log level
 * @param message Log message
 * @param category Log category
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
 * Log a debug message
 * @param message Debug message
 * @param category Log category
 */
export function logDebug(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.DEBUG, message, category);
}

/**
 * Log an info message
 * @param message Info message
 * @param category Log category
 */
export function logInfo(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.INFO, message, category);
}

/**
 * Log a warning message
 * @param message Warning message
 * @param category Log category
 */
export function logWarning(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.WARN, message, category);
}

/**
 * Log an error message
 * @param message Error message
 * @param category Log category
 */
export function logError(message: string, category: LogCategory = LogCategory.GENERAL): void {
	log(LogLevel.ERROR, message, category);
}

/**
 * Display the application banner
 */
export function showBanner(): void {
	console.log(DEPLENS_BANNER);
	console.log(chalk.bold.cyan(`\n  Version: ${APP_INFO.version}`));
	console.log(chalk.bold.cyan(`  Description: ${APP_INFO.description}\n`));
}

/**
 * Create a progress bar
 * @param current Current progress
 * @param total Total progress
 * @param width Width of the progress bar
 * @returns Formatted progress bar string
 */
export function createProgressBar(current: number, total: number, width: number = 30): string {
	const percentage = Math.round((current / total) * 100);
	const filledWidth = Math.round((current / total) * width);
	const emptyWidth = width - filledWidth;

	const filledBar = chalk.greenBright('█'.repeat(filledWidth));
	const emptyBar = chalk.gray('░'.repeat(emptyWidth));

	return `${filledBar}${emptyBar} ${chalk.yellowBright(percentage + '%')}`;
}

/**
 * Display progress
 * @param message Progress message
 * @param current Current progress
 * @param total Total progress
 */
export function showProgress(message: string, current: number, total: number): void {
	const progressBar = createProgressBar(current, total);
	process.stdout.write(`\r${chalk.blue('→')} ${message} ${progressBar}`);
}

/**
 * Clear the progress line
 */
export function clearProgress(): void {
	process.stdout.write('\r\x1b[K');
}

// Progress bar management system
interface ProgressBarConfig {
	name: string;
	totalSteps: number;
	currentStep: number;
	message: string;
	width?: number;
}

class ProgressBarManager {
	private progressBars: Map<string, ProgressBarConfig> = new Map();

	/**
	 * Create a new progress bar
	 * @param name Name of the progress bar
	 * @param totalSteps Total number of steps
	 * @param message Message to display with the progress bar
	 * @param width Width of the progress bar (default: 30)
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
	 * Advance the progress bar by a specified number of steps
	 * @param name Name of the progress bar
	 * @param steps Number of steps to advance (default: 1)
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
	 * Display the progress bar
	 * @param name Name of the progress bar
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

		// Use readline to clear the line and move cursor to beginning
		const progressBarText = `${chalk.blue('→')} ${progressBar.message} ${filledBar}${emptyBar} ${chalk.yellowBright(percentage + '%')}`;
		readline.cursorTo(process.stdout, 0);
		readline.clearLine(process.stdout, 0);
		process.stdout.write(progressBarText);
	}

	/**
	 * Clear the progress bar
	 * @param name Name of the progress bar
	 */
	clear(name: string): void {
		const progressBar = this.progressBars.get(name);
		if (!progressBar) {
			throw new Error(`Progress bar '${name}' not found`);
		}

		// Clear the progress bar line
		readline.cursorTo(process.stdout, 0);
		readline.clearLine(process.stdout, 0);
		this.progressBars.delete(name);
	}

	/**
	 * Get the current progress of a progress bar
	 * @param name Name of the progress bar
	 * @returns Current progress as a percentage
	 */
	getProgress(name: string): number {
		const progressBar = this.progressBars.get(name);
		if (!progressBar) {
			throw new Error(`Progress bar '${name}' not found`);
		}

		return Math.round((progressBar.currentStep / progressBar.totalSteps) * 100);
	}
}

// Export a singleton instance of the progress bar manager
export const progressBarManager = new ProgressBarManager();

/**
 * Convenience function for debug logging
 * @param message Debug message
 * @param category Log category
 */
export function debug(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logDebug(message, category);
}

/**
 * Convenience function for info logging
 * @param message Info message
 * @param category Log category
 */
export function info(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logInfo(message, category);
}

/**
 * Convenience function for warning logging
 * @param message Warning message
 * @param category Log category
 */
export function warn(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logWarning(message, category);
}

/**
 * Convenience function for error logging
 * @param message Error message
 * @param category Log category
 */
export function error(message: string, category: LogCategory = LogCategory.GENERAL): void {
	logError(message, category);
}