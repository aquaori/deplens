# Jev 依赖审查实验

实验分支：`codex/feat-jev-decisions`。默认仍使用 LLM。

## 使用

在被分析项目的 `deplens.config.json` 中启用：

```json
{
  "agent": {
    "review": { "provider": "jev" }
  }
}
```

通过环境变量或当前工作目录的项目 `.env` 提供 `TYPESAFE_API_KEY`，也接受 `JEV_API_KEY`；两者都存在时优先使用前者。可选配置为 `TYPESAFE_BASE_URL`（默认 `https://api.typesafe.ai`）和 `TYPESAFE_DEFAULT_MODEL`（默认 `jev-1.13.0`）。本实验不增加全局 `deplens config` 配置项，也不将 Jev 凭证写进遥测。

运行 `deplens check --review --path <项目路径>`。仅审查时不需要 QWEN 配置；`deplens chat` 仍需现有 QWEN 配置，因为聊天、工具路由和文本生成仍由 LLM 完成。`--json --review` 仍只输出静态分析报告。

在源码仓库里直接试用 Jev 二次复核：

```powershell
npm run dev:review:jev
npm run dev:review:jev -- --path "D:\code\your-project"
```

这等价于 `deplens check --review --review-provider jev`。`--review-provider llm|jev` 只覆盖本次 `check` 的提供方，不修改项目配置，且必须和 `--review` 一起使用。该 Jev 入口只要求现有 Jev 凭证，不构造或调用 LLM。

将 `provider` 改回 `llm` 或移除该项即可恢复原路径。该分支没有发布或部署操作。

## 流程

- Jev 用 Choice 选择允许的调查动作，同一动作不重复执行，最多六轮。存在未完成调查时不提供结束动作；只剩一个动作时程序直接执行。
- 动作置信度不足 0.5 时，以固定顺序继续第一个允许且未完成的调查，不中止审查，也不调用 LLM。记录模型建议和实际动作，避免把调查顺序不确定当作结论不确定。
- 最终请求只对各条当前记录提出三个正向 Noul 问题：局部运行使用、局部工具链使用、是否存在未查清的潜在消费者。运行和工具链使用可以同时成立。完整文件直接放在对应问题中；公共状态保留当前依赖的相关台账、覆盖信息、缺口和调查历史，帮助理解局部记录，不发送整份项目报告。绝对项目路径匿名化为 `local-project`，最终判定不接收用户提问措辞。加载后导出模块算使用，只导出包名不算；未来提案不视为缺失的当前消费者。不再询问局部或全局“未使用”是否成立。声明、扫描器结论、文档和历史记忆不充当当前使用证明。
- Jev 的代码调查额外枚举本地项目文件，对 JS/TS/JSX/TSX 及 JSON 完整读取并检查语法。所有成功检查的文件都参与局部判断，包括没有依赖名称的文件；不是只检查扫描器命中的片段。包清单的依赖声明剔除，其他配置保留。已有直接引用仍参与使用判断。
- 覆盖记录保存在 `coverage`：范围、检查文件、排除目录和具体缺口。排除 `node_modules`、`.git`、`.deplens`、`dist`、`build`、`coverage`；文档、常见静态资源和锁文件不作为执行文件。环境和私钥文件只记录未检查缺口，不读取内容。未知格式、符号链接、读取/解析失败都会阻止未使用结论；monorepo 跨包消费关系尚未验证时也保持待审查。
- 初版覆盖检查有明确上限：2,000 个目录项、32 个已检查文件、单文件 64 KB、累计 128 KB。超过上限不会截断后假装完整，而是记录缺口。因此此版本主要用于小型项目实验，大型或含不支持配置格式的真实项目很可能仍需人工审查。结论仅限已记录的本地范围，不证明外部部署、生成文件或第三方代码没有使用。
- 确认使用与其支持记录仍要求肯定概率至少 0.9，对应二元置信度 0.8。确认未使用要求覆盖完整、重要调查缺口已关闭，并且每个完整文件的运行、工具链、未知消费者分数均不超过 0.1；存在直接引用或相反使用证据时不得建议删除。这改变了证据推导方式，没有调低这些局部判断的确定性门槛。
- 程序将独立判断映射回现有类别。两种使用都有证据时显示 `confirmed-used`，保留工具链判断；只有工具链使用则显示 `likely-tooling-usage`。未声明的直接引用由程序识别为 ghost，不让模型把声明状态与使用方式放进同一单选题。
- 原始三个 Noul 分数保存在 `evidenceDecisions[].probabilities`。局部非使用分数 `localNonUseScore = 1 - max(runtime_usage, tooling_usage, unresolved_consumer)` 由程序计算。`predicateProbabilities` 由局部记录聚合，标记 `predicateSource: "local-evidence-aggregation"`：使用取最高局部分数，`unused_support` 取全部完整文件的最低局部非使用分数。原始分数、派生分数和覆盖是否完整分别记录；派生值不是模型的全局概率。现有融合需要的五类权重保存在 `probabilities`，注明 `distributionSource: "composed-predicates"`，也不是已校准正确率。
- 理由与引用由程序生成，不调用额外 LLM。
- 低置信度、重要缺口未关闭、缺少当前事实或业务冲突均返回待审查。不能把直接使用证据覆盖成可删除；不能忽略其他记录中的运行或工具链使用证据。
- API 边界检查保留答案完整性、类型、合法选项和有效概率。Choice 允许合理的两位小数累积舍入误差；Noul 必须是有限的 0–1 数值。Jev 不使用 LLM 草稿标记、自由文本 JSON 提取或 Zod 草稿解析；聊天与 LLM 审查仍保留这些检查。
- 每次请求超时 10 秒、不重试、不自动切到 LLM。失败只影响当前候选。元数据区分 API 错误、响应错误、低置信度和证据不足，HTTP 状态可用于诊断，但不记录错误响应体和密钥。
- 候选及运行摘要保留动作、最终判定和证据角色的原始概率与置信度。Jev 不读取历史审查记忆；默认的审查结果写入策略仍由现有记忆配置控制。

协议与限制：[官方 API](https://docs.typesafe.ai/api)、[置信度](https://docs.typesafe.ai/confidence)、[模型版本](https://docs.typesafe.ai/models)、[已知局限](https://docs.typesafe.ai/model-jaggedness/jev-1.13)。类型正确不代表判断正确。

## 对照实验

日常迭代默认只跑 Jev，不检查 QWEN 配置，也不创建或调用 LLM。40 例各预热一次、测量三次，共 120 次正式审查，另保留六例换序检查：

```powershell
node ./node_modules/tsx/dist/cli.mjs scripts/jev-experiment.ts --output=.deplens/jev-experiment
```

只有最后需要重新验证替代可行性时，显式开启本轮双提供方对照：

```powershell
node ./node_modules/tsx/dist/cli.mjs scripts/jev-experiment.ts --compare-llm --output=.deplens/jev-final-comparison
```

Jev 单独运行的报告中，`summaries.llm`、依赖 LLM 的比较项及整体替代验收 `passes` 为 `null`，并注明 `comparisonPerformed: false`。原 LLM 报告保留作历史参照，不混入当前测量。`byExpected` 给出各标签的召回、待审查及错误确定结论数量；优化阶段直接对照预先标签和前一版 Jev 的各类别表现。下一轮回归分析与实验安排见 [迭代方案](experiments/jev-next-iteration.md)。

40 个预先标注的合成审查案例位于 `tests/helpers/jev-review-case.ts`，分为工具调用、间接运行使用、未使用文本信号和证据不足四组，每组十例。包含中英文材料。它们是对审查流程的回放，不是实际仓库扫描准确率的证明。

显式对照时，每种提供方每例预热一次、测量三次，共 240 次正式审查。两种提供方使用同一报告、项目文件和六轮上限；交替执行，最多并行处理两例。每次创建独立临时项目，关闭记忆与遥测写入。请求采用 10 秒超时且不重试。连续三次 API 失败后停止该提供方的后续调用，剩余行标为未完成，完整测量检查不能通过。

输入报告、临时项目和调查轮数上限相同，但证据收集及呈现方式不同：LLM 继续使用既有台账摘要，Jev 额外检查本地完整文件并提供结构化记录。这是两条审查路径的系统级对照，不是相同上下文下的纯模型能力比较。

报告记录运行 UUID、Git revision、相关源文件与语料的 SHA-256、模型版本、宏平均 F1、待审查率、错误删除建议、审查 p50/p95、调用次数及 token 数。还记录确定答案数量、确定答案上的准确率与 p50，以及低置信度动作被程序接管的次数。确定答案准确率只描述已作答子集，不代表整体准确率。原始行保存每个案例的降级原因和原始独立概率。

另选六个中英文材料跑完整审查，分别采用正常顺序和反转的动作选项、问题顺序。比较最终类别，记录是否两次均给出确定答案；两个相同的待审查结果不能证明模型提供了稳定的确定结论。

费用估计只覆盖正式测量的 Jev 输入 token，按官方 Jev 1.13 每百万输入 token 0.042 美元计算，不包含预热、探测、稳定性检查或实际账单差异。现有 LLM 使用自定义兼容接口，无法确认其价格，费用留空，不编造费用对比。

验收要求：40 例两种提供方均完成三轮；Jev 错误删除建议为零；宏平均 F1 不低于 LLM；待审查比例增加不超过 5 个百分点；p50 至少降低 50%；p95 不恶化。不满足时保留实验与失败案例，不提升为默认功能。

初版结果见 [原对照结论](experiments/jev-2026-10-11/README.md) 和 [原始报告](experiments/jev-2026-10-11/report.json)。初版 Jev 待审查率为 100%，质量门槛未通过。

新版采用 `atomic-v2` 设计，见 [新版结论](experiments/jev-2026-10-11-v2/README.md) 和 [新版原始数据](experiments/jev-2026-10-11-v2/report.json)。待审查率降到 54.17%，最终 F1 提升到 0.6361；55 个确定答案均与标签一致。未使用案例仍全部待审查，所以待审查率门槛未通过。报告单独保存，不覆盖旧记录，默认仍为 LLM。

第一次覆盖方案 `local-coverage-v3` 的实测见 [中间方案记录](experiments/jev-2026-10-12-v3/README.md)，仍全部弃答未使用。随后 `local-positive-v4` 改用三个正向问题，记录保留在 `docs/experiments/jev-2026-10-12-v4`。当前 `local-boundaries-v6` 恢复匿名化的相关上下文并明确两个语义边界，阈值和覆盖规则未降低。复跑必须指定新目录，避免覆盖历史文件。反复使用原语料属于回归检查，不是独立留出验证。

[当前完整结论](experiments/jev-2026-10-12-v6/README.md)：原 40 个案例三轮测量全部符合标签，宏平均 F1 为 1，待审查率达到标签比例 25%，p50/p95 为 933/1,342 ms。独立的 12 个新标注案例有 5/36 次额外待审查，22 次确定答案全部正确，零错误删除；尚不能宣称所有泛化指标达标。两组换序检查均为六例稳定。日常继续只跑 Jev，不启动 LLM 对照；产品配置默认仍为 LLM，Jev 保持显式选择。

新样本在首次调用前固定标签，使用 `node ./node_modules/tsx/dist/cli.mjs scripts/jev-experiment.ts --holdout --output=.deplens/jev-holdout-new` 单独运行。该报告与原回归集分开，正式审查为 36 次，另有预热和换序检查。本轮没有根据新样本结果继续调提示或更改标签；保留失败供后续分析，下一次优化后需要新的独立确认材料。

`initial-rounding-diagnostic.json` 和 `redundant-action-diagnostic.json` 分别保存舍入检查和重复动作修正前的中断记录，两者均排除在验收之外。

## 离线验证

新增测试使用假凭证与模拟 HTTP 响应，覆盖合法及无效概率、未知选项、缺失答案、两位小数舍入、SDK 超时、限流、调查动作去重、配置调查、轮数耗尽、提前结束、引用冲突、文档与历史记录、融合、无 QWEN 的预审以及 monorepo 同名依赖的失败隔离。新版增加 Noul 边界检查、同时运行和工具链使用、低置信度调查继续执行、唯一动作跳过请求、相互矛盾的独立判断及删除判定中的负面检查。

运行相关 `agent-*` 单元测试、`jev-review-runtime` / `pre-review-runtime` / `cli-smoke` 集成测试，再运行构建。使用临时项目，避免测试改变真实项目的生成状态。

正向局部证据与覆盖版本通过 12 个相关测试套件、76 条测试，测试及测量脚本类型检查、针对改动的 lint 以及构建。新增测试验证完整范围内可确认未使用、额外文件内存在使用时保留依赖，以及未知动态加载器、未知格式、解析失败、环境文件和文件超限均保持待审查。
