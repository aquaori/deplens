# Deplens

![Deplens](./assets/deplens-cli-example.png)

Deplens 是一个面向 Node.js 项目的依赖使用分析工具。它会结合 `npm` / `pnpm` 的 lockfile 和项目源码的 AST 静态分析结果，帮助你识别未使用依赖、monorepo 工作区依赖问题，以及幽灵依赖风险，并尽量降低传统依赖清理工具中常见的误报。

## 功能特性

- **自动识别包管理器**：不需要手动指定 `npm` 或 `pnpm`，Deplens 会自动选择正确的 driver。
- **支持 Monorepo**：能够识别 npm / pnpm workspace，将每个子包当作独立 Node 项目分析，并输出包级别的未使用依赖、workspace 引用和 ghost dependency。
- **支持 JSON 输出**：除了终端可读输出之外，还支持导出结构化 JSON，方便 CI、自动化脚本和后续自定义展示。
- **基于 Lockfile 的分析**：不仅看源码中的直接引用，还会结合 `package-lock.json` 与 `pnpm-lock.yaml` 里的依赖图来判断依赖是否真正有用。
- **可配置忽略规则**：支持通过配置文件或命令行参数忽略指定依赖、路径和文件。

## 技术实现

- 解析 `package-lock.json` 或 `pnpm-lock.yaml`，从 lockfile 中恢复依赖之间的引用关系，判断声明依赖是否真正有意义。
- 使用 `@babel/parser` 和 `@babel/traverse` 对项目源码进行 AST 静态分析，提取 `import` / `require` 使用情况。
- 在 monorepo 场景下，从 `package.json#workspaces`、`pnpm-workspace.yaml` 或兼容的 workspace 清单中识别所有子包，并逐个分析。
- 针对单项目与 monorepo 子包，自动向上寻找最近可用的 lockfile，并匹配正确的包管理器。

## Why Deplens?

很多现有依赖检查工具只会扫描业务代码里的直接 `import`，这在复杂项目里很容易误报。

例如，某个项目声明了：

```json
{
    "dependencies": {
        "react": "19.2.0",
        "react-dom": "19.2.0"
    }
}
```

如果后来业务代码中不再直接引用 `react-dom`，一些传统工具就可能把它判定为未使用依赖，并建议删除。但这个结论未必正确，因为在真实的 lockfile 依赖图中，它可能仍然是项目正常运行所需要的依赖之一。

Deplens 的目标就是减少这种误报。它会综合：

- 源码中的静态引用
- lockfile 中的依赖关系
- monorepo 场景下每个 workspace 包自己的分析结果

因此，相比只看源码 import 的工具，Deplens 的结果通常更可信。

## Deplens 无法完全分析的场景

Deplens 仍然基于静态分析，因此有一些情况它无法完全覆盖：

- **动态导入**：例如 `import(variable)` 或 `require(variable)`，这类依赖是在运行时决定的，无法稳定静态解析。
- **非标准依赖解析方式**：某些框架、插件或工具会通过自定义 API 传入依赖名，而不是标准的 `import` / `require` 语法。
- **别名与虚拟模块**：某些工具链中的 alias、virtual module、特殊 specifier 仍有可能被误识别为 ghost dependency。

如果你确认某个依赖引用方式应该被支持，但当前版本没有识别出来，可以先通过 ignore 配置规避，也欢迎提交 Issue 或 Pull Request 共同完善。

## 安装

```bash
npm install -g @aquaori/deplens
```

这样会把 Deplens 安装到全局环境中，你可以在任意目录直接使用 `deplens` 命令。

如果你只想在当前项目中使用：

```bash
npm install --save-dev @aquaori/deplens
```

## 使用方法

```bash
# 查看版本
deplens -v

# 查看帮助
deplens -h

# 分析当前项目
deplens check
```

可选参数：

- `--path` (`-p`)：指定要分析的项目路径，默认是当前目录。
- `--silence` (`-s`)：静默模式，不输出进度条和普通日志。
- `--ignoreDep` (`-id`)：忽略依赖，多个值使用逗号分隔。
- `--ignorePath` (`-ip`)：忽略路径，多个值使用逗号分隔。
- `--ignoreFile` (`-if`)：忽略文件，多个值使用逗号分隔。
- `--config` (`-c`)：指定自定义配置文件路径。
- `--verbose` (`-V`)：详细输出模式，打印更多分析细节。
- `--json` (`-J`)：以 JSON 格式输出分析结果。
- `--output` (`-o`)：将生成的报告写入文件，当前主要用于 JSON 输出，后续也会用于其他报告格式。

示例：

```bash
# 分析指定项目
deplens check -p D:\my-project

# 将 JSON 结果输出到终端
deplens check --json

# 将 JSON 结果写入文件
deplens check --json -o deplens-report.json
```

如果你是通过本地依赖安装的 Deplens，而不是全局安装，请使用：

```bash
npx @aquaori/deplens check
```

## 配置文件

如果你需要更灵活的控制，可以在项目目录中创建 `deplens.config.json` 文件。

### 忽略依赖

Deplens 默认已经忽略了一些常见路径：

```javascript
["/node_modules/", "/dist/", "/build/", ".git", "*.d.ts"];
```

你也可以自己补充忽略规则：

```json
{
    "ignoreDep": ["nodemon"],
    "ignorePath": ["/test"],
    "ignoreFile": ["/tsconfig.json"]
}
```

也可以显式指定自定义配置文件路径：

```bash
deplens check -c D:\deplens.config.json
```

如果你不想为每个项目都创建配置文件，也可以直接通过命令行传入：

```bash
deplens check -id nodemon,@next/mdx -ip /test,/dist -if /tsconfig.json
```

## 更新日志

- 1.1.0
    - 新增自动包管理器识别，单项目与 monorepo 子包都会自动选择 npm / pnpm driver。
    - 新增 monorepo workspace 分析能力，支持 npm 与 pnpm workspaces。
    - 新增 JSON 报告输出，支持 `--json` 与 `--output`。
    - 新增基于最近 lockfile 的解析逻辑，提升 monorepo 子包分析准确性。
    - 优化 monorepo CLI 输出，包括更紧凑的包摘要和更合理的进度展示。
    - 修复 workspace 中带 BOM 的 `package.json` 导致的解析失败问题。
    - 修复分析完成后 CLI 进程不自动退出的问题。
    - 修复 monorepo 输出中动态导入被显示为 `undefined` 的历史问题。
    - 抑制了一部分转译阶段与结果无关的噪音输出。

- 1.0.7
    - 改进 `.vue` 文件分析支持。

- 1.0.6
    - 修复若干 CLI 与 ignore 规则相关问题。

- 1.0.5
    - 优化日志与结果输出。

- 1.0.4
    - 修复 `.vue` 转译边界问题。

- 1.0.3
    - 新增 `.vue` 支持。
    - 优化输出与 ignore 配置能力。

- 1.0.2
    - 修复初版发布中的部分问题。

- 1.0.1
    - 修复动态导入解析相关问题。

- 1.0.0
    - 初始版本发布。

## 许可证

本项目基于 MIT License 开源。

你可以在保留版权声明的前提下，自由地在个人项目或商业项目中使用、复制、修改和分发 Deplens。

完整协议内容请查看 [MIT License](https://opensource.org/licenses/MIT)。

## 最后

Deplens 还在持续演进中。如果你在使用过程中遇到误报、漏报、monorepo 边界问题，或者其他不符合预期的情况，欢迎提交 Issue 或 Pull Request。真实项目中的反馈，永远是推动这类工具进步最快的方式。
