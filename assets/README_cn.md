# Deplens

[English](../README.md)

![Deplens](./deplens-cli-example.png)

Deplens 是一个面向 Node.js 项目的依赖分析工具。它把 AST 静态分析、Lockfile 解析、monorepo workspace 分析和可选的 AI 复核结合在一起，用来识别：

- 未使用依赖
- 幽灵依赖
- 未声明的 workspace 依赖
- 由于 config、script、tooling 等间接使用而产生的低置信依赖候选

它同时支持 `npm` 和 `pnpm`，既能分析单项目，也能分析 monorepo，并且现在已经提供了基于 LangChain 和大模型的交互式 `review` 模式。

## 功能特性

- **AST + Lockfile 联合分析**：不只看源码里的直接 `import`，还会结合 `package-lock.json` / `pnpm-lock.yaml` 提高结果准确性。
- **自动识别包管理器**：会根据目标项目和最近的 lockfile 自动选择 `npm` 或 `pnpm` driver，不需要手动指定。
- **Monorepo 支持**：自动识别 npm/pnpm workspaces，对每个子包独立分析，再在根级做问题聚合。
- **Evidence 证据链**：分析结果不再只是一个结论，而是会整理出声明证据、引用证据、问题证据和 signal 线索。
- **Signals 非标准使用线索**：支持记录工具链字符串、`require.resolve(...)`、脚本命令等弱证据，用来降低复杂项目中的误报。
- **AI Review 模式**：`review` 命令会进入交互式终端界面，支持通过自然语言询问依赖使用、包级问题、删除风险等。
- **`check` 的 AI PreReview**：可选的 `--preReview` 会对可疑的 unused 候选做二次复核，并把结果分成“高置信未使用 / 疑似工具链间接使用 / 仍需人工复核”。
- **JSON 输出**：除了人类可读的 CLI 输出外，还支持结构化 JSON 输出，方便接 CI、脚本和二次加工。

## 技术实现

- 基于 Babel AST 解析项目源码，提取 `import`、`require` 和可支持的动态引用模式。
- 解析 lockfile 与 manifest，结合包管理器行为、workspace 关系和 monorepo importer 做依赖判断。
- 构建 evidence 图谱，统一整理：
    - 依赖声明证据
    - 依赖引用证据
    - 问题证据
    - 非标准使用 signal
- 在 query/domain 层暴露统一接口，供：
    - CLI 输出
    - JSON 报告
    - monorepo 聚合
    - LangChain tools
      共同复用。
- 通过 LangChain 将项目内工具接入大模型，让模型基于结构化项目数据工作，而不是只凭通用知识回答。
- 只对低置信候选启用 AI 二次复核，避免全量走模型导致 token 成本和响应时延失控。

## Why Deplens？

很多依赖分析工具只会检查业务源码中的直接引用。但在真实项目里，依赖使用方式远不止这些，例如：

- monorepo workspace 之间的依赖关系
- lockfile 中的实际安装结构
- 只在 config 或 tooling 中出现的依赖
- 只在 `package.json scripts` 中使用的依赖
- Babel / Vite / Rollup / ESLint 这类插件或 preset 的字符串式引用

所以，Deplens 的目标不是简单地输出一份 unused 列表，而是进一步回答：

- 这个依赖真的没用了吗？
- 它是不是被代码引用了但没有声明？
- 它是不是通过工具链、配置文件或脚本间接使用？
- 这个结论是高置信的，还是应该人工再复核一下？

这也是为什么后面又引入了 evidence、signals、AI review 和 preReview。

## Deplens 仍然无法完全分析的场景

Deplens 的基础仍然是静态分析，所以这些问题不可能被 100% 解决：

- **完全由运行时决定的动态引用**：尽管 Deplens 引入了 Terser 压缩常量，又使用 Agent 对内容进行二次复核，但仍然存在一些完全由运行时决定的动态引用，例如 `import(variable)` 或 `require(variable)`等，它们无法被静态分析。
- **框架约定式加载**：例如某些运行时 hook、自动发现机制、生成代码。
- **alias / virtual module**：这类不严格映射到真实 npm 包名的场景。
- **AI 复核不是魔法**：它可以增强低置信判断，但不能替代确定性的静态分析，也不能替代真实运行时执行。

因此，Deplens 会尽量把结果分层：

- 高置信静态结果
- 可疑低置信候选
- 可选的 AI 二次复核

这有利于指导你对这些不确定的依赖进行人为的确认。

## 安装

```bash
npm install -g @aquaori/deplens
```

这样就可以全局使用 `deplens` 命令。

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

# 进入交互式 review
deplens review
```

### `check`

```bash
# 分析当前项目
deplens check

# 分析指定项目
deplens check -p D:\my-project

# 输出 JSON 到 stdout
deplens check --json

# 输出 JSON 到文件
deplens check --json -o deplens-report.json

# 对可疑 unused 候选启用 AI preReview
deplens check --preReview
```

`--preReview` 是可选功能，仅在你希望系统对“静态上看似未使用、但又存在可疑线索”的依赖做 AI 二次复核时启用。

**请注意**：二次复核（`preReview`）过程可能会**消耗更多的 Token**，并严重拖累 Deplens 的启动和分析速度，尤其是在一些结构复杂的 Monorepo 项目中，因此为了节省 Token，优化使用体验，无论是`check`还是`review`，除非你要求，否则这个模式默认都不会被开启；在启用这一功能前，也请确保你有足够的 Token 进行复核，避免影响后续的使用体验。

### `review`

```bash
# 进入交互式 review
deplens review

# 对指定项目进入 review
deplens review -p D:\my-project

# 进入 review 前先做 AI preReview
deplens review --preReview
```

`review` 的基本流程是：

- 先扫描项目一次
- 生成当前项目的分析快照
- 把项目内的 query tools 接给大模型
- 在终端里通过自然语言持续提问

典型问题包括：

- 这个项目里哪些依赖真的没用？
- 哪些包的问题最多？
- `react-dom` 能不能删？为什么？
- 为什么这个依赖看起来没 import，但可能还在用？

### 常用参数

- `--path` (`-p`)：指定待分析的项目路径，默认是当前目录。
- `--silence` (`-s`)：静默模式，尽量减少普通 CLI 输出。
- `--ignoreDep` (`-id`)：忽略依赖，多个值用逗号分隔。
- `--ignorePath` (`-ip`)：忽略路径，多个值用逗号分隔。
- `--ignoreFile` (`-if`)：忽略文件，多个值用逗号分隔。
- `--config` (`-c`)：指定自定义配置文件。
- `--verbose` (`-V`)：输出更详细的信息。
- `--json` (`-J`)：输出 JSON 格式结果。
- `--output` (`-o`)：把输出写入文件。
- `--preReview`：启用 AI 二次复核。

如果你是本地安装而不是全局安装：

```bash
npx @aquaori/deplens check
```

## 配置文件

如果你想更细致地控制分析行为，可以在项目目录下创建 `deplens.config.json`。

### 忽略规则

Deplens 默认会忽略一些常见构建和产物目录：

```javascript
["/node_modules/", "/dist/", "/build/", ".git", "*.d.ts"];
```

你也可以通过配置继续扩展：

```json
{
    "ignoreDep": ["nodemon"],
    "ignorePath": ["/test"],
    "ignoreFile": ["/tsconfig.json"]
}
```

也可以显式指定配置文件：

```bash
deplens check -c D:\deplens.config.json
```

或者直接通过命令行传递忽略规则：

```bash
deplens check -id nodemon,@next/mdx -ip /test,/dist -if /tsconfig.json
```

### AI Review 环境变量

`review` 和 `check --preReview` 依赖大模型配置。

你可以在 `.env` 中配置：

```env
QWEN_MODEL=qwen-plus
QWEN_API_KEY=your_api_key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

如果缺少这些变量，Deplens 会直接拒绝进入 AI 流程，并明确告诉你缺了哪些配置。

## 更新日志

- 1.2.2
    - 优化 `preReview`，只对真正可疑的 unused 候选做 AI 复核，降低耗时和 Token 消耗。
    - 调整 `check --preReview` 输出，按最终分层结果展示，而不是只追加复核日志。
    - 增强本地代码 / 配置上下文复核能力，用于解释可疑依赖的间接使用。
    - 优化 review 体验，包括语言跟随、建议内容安全清洗、工具级状态反馈，以及中文终端换行显示。

- 1.2.0
    - 新增基于 LangChain 的交互式 `review` 模式。
    - 新增 `check --preReview`，对可疑 unused 候选进行 AI 二次复核。
    - 新增 evidence 与 signals 体系，用于记录非标准依赖使用线索。
    - 新增依赖 review candidate 分级机制。
    - 新增局部代码上下文 bundle，用于依赖复核和解释。
    - 新增 review 的终端交互界面、结构化输出和渲染层。
    - 新增 review 相关环境变量校验，避免未配置 API 时进入 AI 流程。

- 1.1.0
    - 新增自动包管理器识别，适用于单包和 monorepo。
    - 新增 npm / pnpm workspace 分析能力。
    - 新增 `--json` 和 `--output` 支持，方便输出结构化报告。
    - 新增基于最近 lockfile 的依赖解析逻辑。
    - 优化 monorepo 输出、进度条和摘要展示。
    - 修复 workspace `package.json` 的 BOM 解析问题。
    - 修复 CLI 分析结束后不自动退出的问题。
    - 修复 dynamic import 渲染为 `undefined` 的问题。
    - 压制了一些无关紧要的转译噪音输出。

- 1.0.7
    - 增强 `.vue` 文件分析支持。

- 1.0.6
    - 修复若干 CLI 和 ignore 规则问题。

- 1.0.5
    - 优化 logger 与输出行为。

- 1.0.4
    - 修复 `.vue` 转译边界问题。

- 1.0.3
    - 增加 `.vue` 支持。
    - 优化输出格式和 ignore 选项。

- 1.0.2
    - 修复首个版本中的若干问题。

- 1.0.1
    - 修复 dynamic import 解析问题。

- 1.0.0
    - 初始版本发布。

## 许可证

本项目基于 MIT License 开源。

你可以在遵守版权声明的前提下自由使用、修改、复制和分发本项目。

完整协议见：[MIT License](https://opensource.org/licenses/MIT)

## 最后

Deplens 已经不再只是一个“列出 unused dependencies 的工具”，而是在逐步演进成一个依赖治理助手，核心由以下几层组成：

- 确定性的静态分析
- 结构化 evidence 证据链
- monorepo 根级聚合
- 低置信候选复核
- AI 驱动的交互式解释与 review

尽管在上线前，项目已经经过多种环境的测试，但实际场景通常更加复杂，如果你在真实项目里遇到了错误结论、框架兼容问题，或者某些 monorepo 边界场景，欢迎提交 Issue 或 Pull Request。真实项目里的反馈，是继续打磨 Deplens 的最快方式。
