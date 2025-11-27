import { ArgumentsCamelCase } from 'yargs';
/**
 * 依赖项接口定义
 * 描述项目依赖的基本信息
 */
interface Dependency {
    name: string;
    type: string;
    version: object;
    usage: boolean;
    isDev: boolean;
    args?: string[];
}
/**
 * 分析结果接口定义
 * 描述依赖分析的结果数据结构
 */
interface Result {
    usedDependencies: number;
    unusedDependencies: Dependency[];
    ununsedDependenciesCount: number;
    totalDependencies: number;
    devDependencies: Dependency[];
}
/**
 * 分析项目依赖的主要函数
 * @param args 命令行参数对象
 */
export declare function analyzeProject(args: ArgumentsCamelCase<{
    path: string;
    verbose: boolean;
    pnpm: boolean;
    silence: boolean;
    ignoreDep: string;
    ignorePath: string;
    ignoreFile: string;
    config: string;
}>): Promise<void>;
/**
 * 显示分析结果
 * @param result 分析结果对象
 * @param options 命令行选项
 */
export declare function displayResults(result: Result, options: ArgumentsCamelCase<{
    path: string;
    verbose: boolean;
    pnpm: boolean;
    silence: boolean;
}>): void;
export {};
//# sourceMappingURL=index.d.ts.map