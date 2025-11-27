/**
 * Deplens 应用的 ASCII 艺术 Banner
 * 使用不同颜色显示应用名称
 */
export declare const DEPLENS_BANNER: string;
/**
 * 应用信息配置对象
 * 包含版本号、描述和作者信息
 */
export declare const APP_INFO: {
    version: string;
    description: string;
    author: string;
};
/**
 * 日志级别枚举
 * 定义了四种日志级别：DEBUG, INFO, WARN, ERROR
 */
export declare enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR"
}
/**
 * 日志分类枚举
 * 定义了不同的日志分类：通用、文件系统、网络、分析、依赖、配置
 */
export declare enum LogCategory {
    GENERAL = "GENERAL",
    FILE_SYSTEM = "FILE_SYSTEM",
    NETWORK = "NETWORK",
    ANALYSIS = "ANALYSIS",
    DEPENDENCY = "DEPENDENCY",
    CONFIG = "CONFIG"
}
/**
 * 格式化日志消息
 * @param level 日志级别
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 * @returns 格式化后的日志字符串
 */
export declare function formatLog(level: LogLevel, message: string, category?: LogCategory): string;
/**
 * 输出日志到控制台
 * @param level 日志级别
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function log(level: LogLevel, message: string, category?: LogCategory): void;
/**
 * 输出 DEBUG 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function logDebug(message: string, category?: LogCategory): void;
/**
 * 输出 INFO 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function logInfo(message: string, category?: LogCategory): void;
/**
 * 输出 WARN 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function logWarning(message: string, category?: LogCategory): void;
/**
 * 输出 ERROR 级别日志
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function logError(message: string, category?: LogCategory): void;
/**
 * 显示应用 Banner 和基本信息
 */
export declare function showBanner(): void;
/**
 * 创建进度条字符串
 * @param current 当前进度值
 * @param total 总进度值
 * @param width 进度条宽度（默认为 30）
 * @returns 格式化后的进度条字符串
 */
export declare function createProgressBar(current: number, total: number, width?: number): string;
/**
 * 显示进度信息
 * @param message 进度消息
 * @param current 当前进度值
 * @param total 总进度值
 */
export declare function showProgress(message: string, current: number, total: number): void;
/**
 * 清除进度显示
 */
export declare function clearProgress(): void;
/**
 * 进度条管理器类
 * 用于创建和管理多个进度条
 */
declare class ProgressBarManager {
    private progressBars;
    /**
     * 创建一个新的进度条
     * @param name 进度条名称
     * @param totalSteps 总步骤数
     * @param message 进度消息
     * @param width 进度条宽度（默认为 30）
     */
    create(name: string, totalSteps: number, message: string, width?: number): void;
    /**
     * 推进进度条
     * @param name 进度条名称
     * @param steps 前进步骤数（默认为 1）
     */
    advance(name: string, steps?: number): void;
    /**
     * 显示进度条
     * @param name 进度条名称
     */
    private display;
    /**
     * 清除进度条
     * @param name 进度条名称
     */
    clear(name: string): void;
    /**
     * 获取进度百分比
     * @param name 进度条名称
     * @returns 进度百分比
     */
    getProgress(name: string): number;
}
/**
 * 全局进度条管理器实例
 */
export declare const progressBarManager: ProgressBarManager;
/**
 * 输出 DEBUG 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function debug(message: string, category?: LogCategory): void;
/**
 * 输出 INFO 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function info(message: string, category?: LogCategory): void;
/**
 * 输出 WARN 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function warn(message: string, category?: LogCategory): void;
/**
 * 输出 ERROR 级别日志的便捷函数
 * @param message 日志消息内容
 * @param category 日志分类（默认为 GENERAL）
 */
export declare function error(message: string, category?: LogCategory): void;
export {};
//# sourceMappingURL=cli-utils.d.ts.map