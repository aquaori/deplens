# Deplens 项目建设性建议

基于对仓库代码的深入分析，以下是一些可以提升项目质量、可维护性和用户体验的建设性建议。

## 📋 目录

1. [代码质量改进](#代码质量改进)
2. [架构优化](#架构优化)
3. [测试覆盖](#测试覆盖)
4. [用户体验](#用户体验)
5. [文档完善](#文档完善)
6. [CI/CD 建议](#cicd-建议)
7. [功能扩展建议](#功能扩展建议)

---

## 代码质量改进

### 1. 添加 `.gitignore` 文件 ✅

项目缺少 `.gitignore` 文件，建议添加以排除：
- `node_modules/` - 依赖目录
- `dist/` - 构建产物
- `coverage/` - 测试覆盖率报告
- IDE 配置文件

### 2. 移除未使用的依赖

根据工具自身的分析，以下依赖在 `package.json` 中声明但可能需要检查使用方式：
- `@babel/plugin-syntax-import-assertions`
- `@babel/preset-react`
- `@babel/preset-typescript`

**注意**：这些依赖实际上是通过 `require.resolve()` 动态加载的（见 `index.ts` 第149-165行），这是 Deplens 目前无法检测到的使用模式。建议：
- 在 README 中说明这种特殊情况
- 或者考虑改进 Deplens 以支持检测 `require.resolve()` 的使用

### 3. 修复 TypeScript 相关问题

**a) 移除重复的 `@types/yargs`**

`@types/yargs` 同时存在于 `dependencies` 和 `devDependencies` 中（通过 `@types/chalk` 间接引入）。类型声明包应该只在 `devDependencies` 中。

**b) 移除 `@ts-ignore` 注释**

`index.ts` 中有两处 `@ts-ignore`：
```typescript
// @ts-ignore
import yaml from 'js-yaml';
// @ts-ignore
import { minify } from 'terser';
```

建议安装对应的类型声明包或创建声明文件：
```bash
npm install -D @types/js-yaml
```

### 4. 代码规范化

**a) 统一代码风格**

建议添加 ESLint 和 Prettier 配置：

```bash
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```

**b) 统一缩进风格**

当前代码混合使用了 Tab 和空格缩进，建议统一使用 Tab 或空格。

---

## 架构优化

### 1. 模块化重构

`index.ts` 文件包含了所有核心逻辑（600+ 行），建议拆分为独立模块：

```
src/
├── cli.ts              # CLI 入口（保持现状）
├── cli-utils.ts        # CLI 工具函数（保持现状）
├── index.ts            # 主导出
├── analyzer/
│   ├── index.ts        # 分析器主入口
│   ├── scanner.ts      # 文件扫描逻辑
│   ├── parser.ts       # AST 解析逻辑
│   └── dependency.ts   # 依赖分析逻辑
├── lockfile/
│   ├── npm.ts          # npm lockfile 解析
│   └── pnpm.ts         # pnpm lockfile 解析
├── types/
│   └── index.ts        # 类型定义
└── utils/
    ├── transpiler.ts   # 代码转译工具
    └── minifier.ts     # 代码压缩工具
```

### 2. 配置管理优化

当前配置文件解析逻辑在多处重复（`scan` 函数和 `getDependencies` 函数中），建议提取为独立的配置加载模块：

```typescript
// src/config/loader.ts
interface DeplensConfig {
  ignoreDep?: string[];
  ignorePath?: string[];
  ignoreFile?: string[];
}

export function loadConfig(projectPath: string, configPath?: string): DeplensConfig {
  // 统一的配置加载逻辑
}
```

### 3. 错误处理改进

建议创建自定义错误类型，提供更清晰的错误信息：

```typescript
// src/errors.ts
export class LockfileNotFoundError extends Error {
  constructor(public lockfileType: 'npm' | 'pnpm', public projectPath: string) {
    super(`${lockfileType} lockfile not found at ${projectPath}`);
    this.name = 'LockfileNotFoundError';
  }
}

export class ParseError extends Error {
  constructor(public filePath: string, public originalError: Error) {
    super(`Failed to parse ${filePath}: ${originalError.message}`);
    this.name = 'ParseError';
  }
}
```

---

## 测试覆盖

### 1. 创建测试目录结构

当前 Jest 配置指向 `tests` 目录，但该目录不存在。建议创建完整的测试结构：

```
tests/
├── unit/
│   ├── scanner.test.ts
│   ├── parser.test.ts
│   └── dependency.test.ts
├── integration/
│   └── analyzer.test.ts
├── fixtures/
│   ├── npm-project/
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   └── src/
│   └── pnpm-project/
│       ├── package.json
│       ├── pnpm-lock.yaml
│       └── src/
└── setup.ts
```

### 2. 单元测试建议

**核心功能测试示例**：

```typescript
// tests/unit/dependency.test.ts
describe('getDependencies', () => {
  it('should parse npm lockfile correctly', async () => {
    // 测试 npm lockfile 解析
  });

  it('should parse pnpm lockfile v6 correctly', async () => {
    // 测试 pnpm v6 lockfile 解析
  });

  it('should parse pnpm lockfile v9 correctly', async () => {
    // 测试 pnpm v9 lockfile 解析
  });

  it('should respect ignoreDep configuration', async () => {
    // 测试忽略依赖功能
  });
});
```

---

## 用户体验

### 1. 输出结果改进

**a) 添加 JSON 输出格式**

为了方便 CI/CD 集成，建议支持 JSON 输出：

```bash
deplens check --format json > report.json
```

**b) 添加退出码支持**

```typescript
// 根据结果设置退出码
if (result.ununsedDependenciesCount > 0) {
  process.exit(1); // 发现未使用依赖
}
process.exit(0); // 所有依赖都在使用
```

### 2. 修复 CLI 提示信息

`displayResults` 函数（第586行）中引用了不存在的 `options["ignore"]` 属性：

```typescript
// 当前代码
if(result.unusedDependencies.length > 0 && options["config"] === "" && options["ignore"] === "" ...)

// 应改为
if(result.unusedDependencies.length > 0 && options["config"] === "" && options["ignoreDep"] === "" ...)
```

### 3. 国际化支持

考虑到 README 使用中文编写，建议添加多语言支持：

```typescript
// src/i18n/index.ts
const messages = {
  'zh-CN': {
    analyzing: '正在分析项目依赖...',
    unusedFound: '发现 {count} 个未使用的依赖',
  },
  'en': {
    analyzing: 'Analyzing project dependencies...',
    unusedFound: 'Found {count} unused dependencies',
  }
};
```

---

## 文档完善

### 1. 添加 CONTRIBUTING.md

```markdown
# 贡献指南

## 开发环境设置
1. Fork 并 clone 仓库
2. 安装依赖：`npm install`
3. 构建项目：`npm run build`
4. 运行测试：`npm test`

## 代码规范
- 使用 TypeScript
- 遵循 ESLint 规则
- 所有新功能需要添加测试

## 提交规范
使用 Conventional Commits 格式：
- feat: 新功能
- fix: 修复
- docs: 文档
- refactor: 重构
```

### 2. 添加 API 文档

对于希望以编程方式使用 Deplens 的用户，建议添加 API 文档：

```typescript
import { analyzeProject } from '@aquaori/deplens';

const result = await analyzeProject({
  path: '/path/to/project',
  pnpm: false,
  verbose: true,
  silence: false,
  ignoreDep: '',
  ignorePath: '',
  ignoreFile: '',
  config: ''
});
```

---

## CI/CD 建议

### 1. 添加 GitHub Actions 工作流

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
```

### 2. 自动发布配置

```yaml
# .github/workflows/release.yml
name: Release

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 功能扩展建议

### 1. 支持更多锁文件格式

- **yarn.lock** - Yarn 包管理器支持
- **bun.lockb** - Bun 运行时支持

### 2. 增强动态导入检测

当前工具无法检测以下模式：
- `require.resolve('module')` - 解析模块路径
- 模板字符串导入：`` require(`${prefix}module`) ``
- 条件导入：`const mod = condition ? require('a') : require('b')`

建议增加对这些模式的部分支持。

### 3. 添加自动修复功能

```bash
deplens check --fix  # 自动移除未使用的依赖
```

### 4. 工作空间（Monorepo）支持

支持分析 npm/pnpm/yarn 工作空间项目：

```bash
deplens check --workspace  # 分析整个工作空间
deplens check --workspace packages/app  # 分析特定包
```

### 5. 依赖可视化

生成依赖关系图：

```bash
deplens graph --output dependency-graph.html
```

---

## 总结

Deplens 是一个很有价值的工具，能够解决传统依赖分析工具的误报问题。通过实施上述建议，可以：

1. **提高代码质量** - 通过模块化和类型安全改进
2. **增强可靠性** - 通过完善的测试覆盖
3. **改善用户体验** - 通过更好的 CLI 输出和错误信息
4. **扩展生态系统** - 通过支持更多包管理器和使用场景

感谢您创建这个有用的工具！🎉
