# Evidence 层说明

## 这一层是为了解决什么问题

在引入 Evidence 层之前，Deplens 已经具备这些能力：

- 扫描项目文件
- 构建 AST
- 解析 lockfile
- 分析未使用依赖
- 分析 monorepo 下的幽灵依赖、workspace 依赖问题

这些能力本身已经足够支撑 CLI 的一次性 `check` 输出，但还不够支撑后续这些场景：

- 结构化查询
- 可复用的工具调用
- 后续的 RAG / Skills / Insight 模式
- 可解释回答，例如“为什么这个依赖被判 unused？”

所以 Evidence 层的职责，不是替代现有分析器，而是作为中间层，把：

- 原始事实：源码、AST、package.json
- 分析结果：unused / ghost / workspace issue
- 上层消费：查询 API、后续 tools、skills、RAG

连成一条结构化证据链。

一句话概括：

Evidence 层把“分析结果”变成“可查询、可解释、可复用的证明链”。

## 这次具体加了什么

### 1. 保留文件上下文的源码采集能力

文件：

- [src/analyzer/scanner.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/analyzer/scanner.ts)

之前 `scan()` 只返回处理后的代码字符串，这意味着分析阶段丢掉了：

- 代码来自哪个文件
- import 出现在文件的什么位置

现在拆成了两层：

- `readProjectSourceFiles(args)`
  - 返回 `ScannedSourceFile[]`
  - 保留 `path` 和处理后的 `code`
- `scan(args)`
  - 继续返回 `string[]`
  - 保持对旧分析流程兼容

这一步是 Evidence 层的基础，没有它就拿不到可靠的引用位置。

### 2. Evidence 数据模型

文件：

- [src/types/index.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/types/index.ts)

新增的核心类型有：

- `DeclarationEvidence`
- `ReferenceEvidence`
- `IssueEvidence`
- `PackageEvidenceChain`
- `MonorepoEvidenceIndex`

这些类型就是后续所有 query / tools / skills 的基础数据结构。

### 3. package 级 evidence 构建器

文件：

- [src/evidence/index.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/evidence/index.ts)

核心入口：

- `buildPackageEvidenceChain(input)`

它会为一个 package 生成三类证据：

- `declarations`
- `references`
- `issues`

### 4. monorepo 根级 evidence 聚合索引

文件：

- [src/evidence/index.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/evidence/index.ts)
- [src/driver/monorepo.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/driver/monorepo.ts)
- [src/report/builders.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/report/builders.ts)

核心入口：

- `buildMonorepoEvidenceIndex(packages)`

它会把每个子包自己的 evidence 聚合成仓库级索引。

### 5. Evidence 查询 API

文件：

- [src/evidence/query.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/evidence/query.ts)
- [src/index.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/index.ts)

新增并对外导出的 API：

- `findDependencyReferences()`
- `findDependencyDeclarations()`
- `findIssueEvidence()`
- `explainDependencyEvidence()`

## Evidence 数据模型怎么理解

### `DeclarationEvidence`

表示：

- 某个依赖是在哪里声明的
- 它属于 `package.json` 的哪个 section

字段：

- `id`
- `packageName`
- `dependencyName`
- `manifestPath`
- `section`
- `versionRange`

它回答的问题是：

- 这个依赖为什么会出现在 package.json 里？
- 它是 `dependencies`、`devDependencies` 还是别的？

### `ReferenceEvidence`

表示：

- 某个依赖在源码里哪里被引用了
- 它是通过什么方式被引用的

字段：

- `id`
- `packageName`
- `dependencyName`
- `filePath`
- `line`
- `column`
- `kind`
- `specifier`
- `isWorkspaceReference`

当前 `kind` 支持：

- `import`
- `require`
- `dynamic-import`

它回答的问题是：

- 谁引用了这个依赖？
- 在哪个文件、哪一行？
- 是静态 import 还是 require / dynamic import？

### `IssueEvidence`

表示：

- 某个问题为什么成立
- 这个问题背后依赖了哪些 supporting evidence

字段：

- `id`
- `packageName`
- `dependencyName`
- `issueType`
- `reason`
- `supportingEvidenceIds`

当前 `issueType` 支持：

- `unused-dependency`
- `ghost-dependency`
- `undeclared-workspace-dependency`

它回答的问题是：

- 为什么系统认为这个依赖有问题？
- 这个判断的证据链是什么？

### `PackageEvidenceChain`

这是 package 级别的 evidence 容器：

```ts
{
  declarations: DeclarationEvidence[]
  references: ReferenceEvidence[]
  issues: IssueEvidence[]
}
```

你可以把它理解成：

- 一个包的完整证据集

### `MonorepoEvidenceIndex`

这是 monorepo 根级别的 evidence 聚合索引：

```ts
{
  packages: string[]
  declarations: DeclarationEvidence[]
  references: ReferenceEvidence[]
  issues: IssueEvidence[]
  declarationsByDependency: Record<string, DeclarationEvidence[]>
  referencesByDependency: Record<string, ReferenceEvidence[]>
  issuesByDependency: Record<string, IssueEvidence[]>
  declarationsByPackage: Record<string, DeclarationEvidence[]>
  referencesByPackage: Record<string, ReferenceEvidence[]>
  issuesByPackage: Record<string, IssueEvidence[]>
}
```

这个结构的意义在于：

- package 自己的 evidence 适合局部解释
- 根级 index 适合全仓检索和快速查询

后续如果要做 insight / skills，monorepo 场景优先应该走这个根级 index。

## Evidence 是怎么生成的

### 单项目的数据流

文件：

- [src/analyzer/index.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/analyzer/index.ts)

当前流程：

1. `runProjectAnalysis(args)` 先跑原来的依赖分析逻辑，得到 `summary`
2. `buildPackageEvidenceChain({ args, summary })` 生成 evidence
3. `buildProjectAnalysisReport(path, summary, evidence)` 组装成最终 report

也就是说：

- `summary` 负责告诉你“问题是什么”
- `evidence` 负责告诉你“为什么会这样”

### monorepo 的数据流

文件：

- [src/driver/monorepo.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/driver/monorepo.ts)

当前每个 workspace package 的流程：

1. 先分析当前 package 的 summary
2. 再算 workspace / ghost / undeclared workspace dependency
3. 调 `buildPackageEvidenceChain(...)`
4. 构建 package report

在所有包都分析完成后：

5. 调 `buildMonorepoEvidenceIndex(packages)`
6. 把这个 index 挂到 monorepo 根 report 上

所以 monorepo 报告现在有两层：

- `packages[i].evidence`
- `report.evidenceIndex`

## 公开接口有哪些

这些接口都已经从 [src/index.ts](C:/Users/ASUS/Desktop/code/web/deplens/src/index.ts) 导出了。

### `buildPackageEvidenceChain(input)`

用途：

- 直接为某个 package 构建 evidence

输入大致长这样：

```ts
{
  args,
  summary,
  packageName?,
  manifest?,
  manifestPath?,
  ghostDependencies?,
  undeclaredWorkspaceDependencies?,
  workspaceNames?
}
```

返回值：

- `Promise<PackageEvidenceChain>`

### `buildMonorepoEvidenceIndex(packages)`

用途：

- 当你已经拿到 monorepo 下所有 package report 时，构建仓库级 evidence 索引

返回值：

- `MonorepoEvidenceIndex`

### `findDependencyReferences(input, options)`

用途：

- 查一个依赖在哪些地方被引用了

支持的 `input`：

- `PackageEvidenceChain`
- `SingleProjectAnalysisReport`
- `MonorepoAnalysisReport`
- `MonorepoEvidenceIndex`

支持的 `options`：

- 直接传依赖名字符串，例如：

```ts
"react-dom"
```

- 或传对象：

```ts
{
  dependencyName?: string
  packageName?: string
}
```

### `findDependencyDeclarations(input, options)`

用途：

- 查一个依赖是在哪里声明的

参数风格和 `findDependencyReferences()` 一样。

### `findIssueEvidence(input, options)`

用途：

- 直接查 issue 证据

可选参数：

```ts
{
  dependencyName?: string
  packageName?: string
  issueType?: "unused-dependency" | "ghost-dependency" | "undeclared-workspace-dependency"
}
```

### `explainDependencyEvidence(input, options)`

用途：

- 一次性返回某个依赖的 declarations / references / issues

返回结构：

```ts
{
  declarations,
  references,
  issues
}
```

这个接口是后续最适合给工具层或自然语言解释层直接调用的。

## 接口分层说明

当前接口其实分成两层：

- `src/evidence/query.ts`
  - 底层证据查询层
  - 负责“查事实”
- `src/query/domain.ts`
  - 高层领域接口层
  - 负责“回答问题”

你可以把它理解成：

- `evidence/query`
  - 更接近数据库查询
  - 适合查“声明 / 引用 / issue 证据”
- `query/domain`
  - 更接近业务能力
  - 适合直接给后续 AI tool 调用

### `src/evidence/query.ts` 这一层的用途

这一层直接围绕 evidence 工作，不做太多业务判断，主要负责把证据本身取出来。

#### `findDependencyReferences(input, options)`

用途：

- 查某个依赖在哪里被引用了

返回：

- `ReferenceEvidence[]`

适合回答：

- 谁引用了 `react-dom`
- `lodash` 出现在哪些文件
- 哪个包里引用了某个依赖

#### `findDependencyDeclarations(input, options)`

用途：

- 查某个依赖在哪里被声明了

返回：

- `DeclarationEvidence[]`

适合回答：

- `react-dom` 是在哪个 `package.json` 里声明的
- 它属于 `dependencies` 还是 `devDependencies`
- monorepo 里哪些包声明过它

#### `findIssueEvidence(input, options)`

用途：

- 查某个 issue 的证据

返回：

- `IssueEvidence[]`

适合回答：

- 哪些依赖被判成 `unused-dependency`
- 哪些包有 `ghost-dependency`
- 某个包里有哪些 `undeclared-workspace-dependency`

#### `explainDependencyEvidence(input, options)`

用途：

- 一次性返回某个依赖相关的全部核心证据

返回：

```ts
{
  declarations,
  references,
  issues
}
```

适合回答：

- 这个依赖的完整证据链是什么
- 为什么系统会对这个依赖做出某个判断

### `src/query/domain.ts` 这一层的用途

这一层不是单纯查 evidence，而是把底层 evidence/query 组合成更像业务问题的接口。

它更接近未来 AI Tool 的直接调用层。

#### `getProjectSummary(report)`

用途：

- 获取项目级总览

返回内容包括：

- 项目类型
- 包数量
- 有 unused 的包数量
- 有 ghost 的包数量
- declaration / reference / issue 总量

适合回答：

- 这个项目整体情况怎么样
- monorepo 里有多少个包有问题

#### `getPackageSummary(report, packageName?)`

用途：

- 获取某个包的依赖摘要

返回内容包括：

- 声明依赖数
- 引用依赖数
- unused dependencies
- ghost dependencies
- workspace dependencies
- issue 数量

适合回答：

- `packages/app` 的依赖情况怎么样
- 某个子包有哪些明显问题

#### `getPackageNames(report)`

用途：

- 列出当前 report 中有哪些包

适合回答：

- 这个 monorepo 里有哪些 workspace package
- 当前单项目默认包名是什么

#### `getUnusedDependencies(report, packageName?)`

用途：

- 直接拿 unused dependency 列表

返回：

- `string[]`

适合回答：

- 这个项目有哪些未使用依赖
- 某个子包有哪些 unused dependency

#### `getGhostDependencies(report, packageName?)`

用途：

- 直接拿 ghost dependency 列表

返回：

- `string[]`

适合回答：

- 哪些依赖被引用了但没声明
- 某个 workspace 包有哪些幽灵依赖

#### `getDependencyOverview(report, dependencyName, packageName?)`

用途：

- 获取某个依赖的整体状态概览

返回内容包括：

- declarations
- references
- issues
- 是否已声明
- 是否被引用
- 是否 ghost
- 是否 unused
- 是否 undeclared workspace dependency
- 被哪些包引用
- 出现在哪些文件

适合回答：

- `react-dom` 现在到底是什么状态
- 它有没有声明、引用、问题
- 哪些包在用它

#### `canRemoveDependency(report, dependencyName, packageName?)`

用途：

- 给出一个基础版“能不能卸载”的判断

返回内容包括：

- `recommended`
- `confidence`
- `riskLevel`
- `reason`
- 相关 declarations / references / issues

适合回答：

- `react-dom` 能卸载吗
- 删除这个依赖风险高不高
- 为什么这么判断

注意：

- 现在还是基础版
- 主要依赖静态引用和 unused issue
- 还没有纳入 scripts/config/framework convention

### 两层该怎么选

如果你后面是自己写组合逻辑，或者要查非常底层的证据明细，就优先用：

- `src/evidence/query.ts`

如果你后面是给 AI / Tool / Insight 模式直接调用，更推荐优先用：

- `src/query/domain.ts`

一句话总结：

- `evidence/query.ts` = 查证据事实
- `query/domain.ts` = 回答业务问题

## 推荐怎么使用这一层

### 1. 想解释单个依赖

例如：

```ts
explainDependencyEvidence(report, {
  dependencyName: "react-dom",
  packageName: "app"
})
```

这能直接拿到：

- 它在哪里声明
- 它在哪里引用
- 它有没有对应 issue

### 2. 想看 monorepo 全仓的 ghost dependency

例如：

```ts
findIssueEvidence(monorepoReport, {
  issueType: "ghost-dependency"
})
```

或者缩小到单个包：

```ts
findIssueEvidence(monorepoReport.evidenceIndex, {
  packageName: "@scope/foo",
  issueType: "ghost-dependency"
})
```

### 3. 想回答“谁引用了这个依赖”

例如：

```ts
findDependencyReferences(monorepoReport.evidenceIndex, {
  dependencyName: "lodash"
})
```

### 4. 想回答“这个依赖在哪里声明过”

例如：

```ts
findDependencyDeclarations(monorepoReport.evidenceIndex, {
  dependencyName: "react-dom"
})
```

## 当前这层的边界和限制

这层已经能用，但还不是最终形态。

### 1. 目前主要追踪静态源码引用

现在能抓到的主要是：

- `import`
- `require("x")`
- `import("x")`

还没覆盖这些场景：

- `package.json scripts`
- 配置文件语义引用
- 别名解析，例如 `~utils`
- 框架虚拟模块
- 更复杂的运行时约定

### 2. 它是“源码证据层”，不是“执行语义层”

如果某个依赖只通过这些方式被用到：

- scripts
- 构建配置
- 工具链约定
- 框架魔法行为

那它仍然可能在 evidence 里表现成 unused。

### 3. query API 目前是“事实查询”，不是“建议系统”

当前 API 更适合回答这些问题：

- 声明在哪
- 引用在哪
- 有什么 issue

它还不直接回答这些更高层问题：

- 这个依赖能不能安全删除
- 删除风险有多高
- 哪个子包最值得治理

这些更适合放在下一层 domain helper 里做。

## 为什么这层对后续 Insight 模式很重要

如果没有 Evidence 层，后续 tools / skills 想回答问题，就只能：

- 每次重新扫 AST
- 每次重新拼 manifest + summary + monorepo 关系
- 每次重新临时构造推理链

这样的问题是：

- 成本高
- 不稳定
- 不利于复用

有了 Evidence 层之后，后续工具可以直接问：

- 这个依赖声明在哪？
- 这个依赖被谁引用？
- 这个 issue 的 supporting evidence 是什么？
- monorepo 下哪些包都碰到了这个依赖？

所以 Evidence 层本质上是未来 Insight / Skills / RAG 的数据底座。

## 最小心智模型

如果你现在只记一件事，就记这个三层分工：

- `summary`
  - 高层分析结论
  - 回答“有什么问题”

- `evidence`
  - 证明链
  - 回答“为什么有这个问题”

- `query API`
  - 消费层
  - 回答“后续工具应该怎么拿这些证据”

这就是这次重构最核心的价值。
