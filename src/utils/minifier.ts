import { minify } from 'terser';

/**
 * 压缩 JavaScript 代码
 * @param code 待压缩的代码
 * @returns 压缩后的代码
 */
export async function minifyCode(code: string) {
    const result = await minify(code, {
        compress: {
        evaluate: true,        	   	// 启用常量折叠
        reduce_vars: true,    	    // 常量传播（内联变量）
        inline: true,         	    // 内联简单函数（可选）
        dead_code: true,      	    // 删除死代码（如 if (false)）
        unsafe: true,         	    // 允许字符串/布尔等 unsafe 优化
        passes: 3,                	// 多轮优化，提高折叠率
        },
        mangle: false,              // 不混淆变量名（便于调试，非必须）
        module: true,               // 按 ES 模块处理（支持顶层 await、import 等）
        sourceMap: false,
        keep_fnames: true,
    });
    return result.code;
}