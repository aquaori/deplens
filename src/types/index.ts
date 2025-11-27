
/**
 * 依赖项接口定义
 * 描述项目依赖的基本信息
 */
export interface Dependency {
    name: string;           // 依赖包名称
    type: string;           // 依赖类型 (import/require/dynamic)
    version: object;        // 依赖版本
    usage: boolean;         // 是否被使用
    isDev: boolean;         // 是否为开发依赖
    args?: string[];        // 参数（可选）
}

/**
 * 分析结果接口定义
 * 描述依赖分析的结果数据结构
 */
export interface Result {
    usedDependencies: number;             // 已使用的依赖数量
    unusedDependencies: Dependency[];     // 未使用的依赖列表
    ununsedDependenciesCount: number;     // 未使用的依赖数量
    totalDependencies: number;            // 总依赖数量
    devDependencies: Dependency[];        // 开发依赖列表
}

export interface LogQueue {
    type: string;
    message: string;
}