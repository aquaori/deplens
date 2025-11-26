# Deplens

![Deplens](https://api.lumirant.top/v1/images/GetImage/GetImageByFileName?filename=deplens-example.jpg)

Deplens 是一个专为 npm 和 pnpm 项目设计的依赖使用情况分析工具，能够更加精准的分析多种环境下的Nodejs依赖是否被使用，筛选出冗余无用的依赖，帮助开发者优化项目结构，减少依赖库体积。

## 核心特性

- **精准分析**：能够利用 pnpm 的非嵌套、内容寻址存储特性，在 pnpm 环境中更准确的识别依赖使用情况。
- **高度兼容性**：同时支持 npm 和 pnpm 两种常用包管理器，支持分析 pnpm-lock.yaml v6 和 v9 两种广泛使用的lockfile版本，同时还支持通过配置文件和命令参数自定义忽略目录。
- **完整依赖图谱**：不仅分析项目源码引用，还递归分析依赖包自身的引用关系。
- **更低的误报概率**：通过构建完整的"依赖使用图谱"，准确判断每个声明的依赖是否真正被使用。

## 技术实现

- 解析 `package-lock.json` 或 `pnpm-lock.yaml` 文件结构，并分析各依赖间的依赖关系，构建完整依赖关系视图
- 使用 `@babel/parser` 和 `@babel/traverse` 对项目源码进行 AST 静态分析
- 通过 BFS/DFS 算法传播依赖使用状态

## Why Deplens?

Deplens诞生的最初目的就是为了解决目前市面上的传统检测工具普遍无法分析`node_modules`中各依赖间的复杂引用关系而导致的误报问题，能够更加精准的分析多种环境下的Nodejs依赖是否被使用，举个简单的例子：

假设我们有个项目，使用了`react`作为技术栈，而项目中的某个地方直接使用了`react-dom`提供的某个模块实现了某个功能，那么这个时候，`react-dom`确实就已经被引用了，于是在packages.json中，它大概是这样的：

```json
{
    "dependencies": {
        "react": "19.2.0",
        "react-dom": "19.2.0"
    }
}
```
现在再假设在某次优化中，我们使用了另一个更成熟的依赖库实现了原本用`react-dom`实现的这部分逻辑，那么`react-dom`此时在项目中就不会被引入了，在传统的依赖分析，但package.json本身并没有被改变，所以直观上来说，`react-dom`似乎确实是一个冗余依赖，可以被卸载，用于减少项目体积，而在部分传统工具中，也确实会出现类似的情况（当然，`react-dom`这种常见的情况是不会出现的，毕竟这个框架太常用了）。

但事实却是，`react`本身需要用到`react-dom`作为它的Peer依赖项（Peer Dependencies），也就是说`react-dom`在项目中是有作用的，少了这个依赖，`react`就不能正常运行了，所以它不能被卸载。

而Deplens就是通过lockfile（如`package-lock.json`和`pnpm-lock.yaml`）分析项目的依赖图谱，递归分析依赖包自身的引用关系，从而准确判断每个声明的依赖是否真正被使用，从而筛选出确实冗余无用的依赖，解决传统工具的弊端，提高结果的可信度。

## Deplens无法处理的情况

即使Deplens在开发阶段已经考虑到了大多数情况下的依赖使用情况，但已知仍然存在一些情况，Deplens无法处理，主要包括以下几种：

- 动态引入（如`import('module')`或`require(constantValue)`），Deplens无法分析到这些依赖的使用情况，因为动态引入是在运行时才确定的，而Deplens只能静态分析项目代码，尽管在上下文中，Deplens会对部分可分析的代码尝试常量折叠，但在大部分情况下，动态引入的内容并没有被完全确定，因此无法作为静态内容被分析。
- 在引入时使用了自定义的语法（如`require("@babel/core").transformSync("code", { plugins: ["transform-minify-booleans"] });`），这些依赖的引入方式不属于标准语法中的格式，是插件自身提供的一种特殊引入方式，因此Deplens无法分析到这些依赖的使用情况。

如果你发现有一些你确定有引用，但Deplens却没有检测到的情况，有可能就是出现了上述问题，你可以通过[**配置忽略依赖**](#忽略依赖)（见下文）的方式来解决这个问题。

当然，如果你愿意帮助我们完善Deplens的功能，也欢迎提交PR或Issue，我们会尽快处理。

## 安装

```bash
npm install @aquaori/deplens -g
```

该命令会直接将deplens安装到全局环境中，你可以在任何项目中使用该工具。
如果你只需要在当前项目中使用该工具，而不希望将其安装到全局环境中，你可以使用以下命令：

```bash
npm install @aquaori/deplens --save-dev
```

该命令会将deplens安装到当前项目的`devDependencies`中，你可以在项目的`package.json`文件中查看该依赖。

## 使用

```bash
## 获取工具版本号
deplens -v
## 获取帮助
deplens -h
# 分析当前项目依赖
deplens check
```

可选参数：

- `--path` (`-p`)：指定要分析的项目路径，默认当前目录
- `--pnpm` (`--pn`)：指定项目使用 pnpm 作为包管理器，默认 npm
- `--silence` (`-s`)：静默模式，不输出进度条
- `--ignoreDep` (`-id`)：指定要忽略的依赖，多个依赖之间用英文逗号`,`分隔
- `--ignorePath` (`-ip`)：指定要忽略的路径，多个路径之间用英文逗号`,`分隔
- `--ignoreFile` (`-if`)：指定要忽略的文件，多个文件之间用英文逗号`,`分隔
- `--config` (`-c`)：指定自定义配置文件路径
- `--verbose` (`-V`)： 详细模式，将会输出所有分析结果，包括dev依赖

注意：如果你在安装时使用了`--save-dev`参数，而非全局安装，那么你不能直接使用`deplens`命令，而是需要通过以下方式来运行该工具：

```bash
npx @aquaori/deplens check
```

## 配置文件

如果你希望获得更大的自由度，可以在命令运行的目录下创建配置文件：`deplens-config.json`。

### 忽略依赖

为了简化操作，Deplens原生支持忽略一些常见的文件和目录：

```javascript
    ['/node_modules/', '/dist/', '/build/', '.git', '*.d.ts']
```

但如果你还需要忽略一些其它的依赖、路径和文件，可以在配置文件中自定义：

```json
{
    "ignoreDep": [
        "nodemon"
    ],
    "ignorePath": [
        "/test",
    ],
    "ignoreFile": [
        "/tsconfig.json"
    ]
}
```

这样，在命令运行时，就会自动读取目录中的配置文件，并跳过对其中提到的依赖、路径和文件的分析。

或者，你也可以在运行命令时使用`--config`或`-c`参数，指定一个配置文件，它不一定要在当前目录下，也可以在本机的任何地方，例如：

```bash
deplens check -c D:\deplens-config.json
```

又或者，如果你不想在每个项目中都创建一个配置文件，你还可以直接在运行命令时使用`--ignoreDep`、`--ignorePath`、`--ignoreFile`参数，分别指定你需要忽略的依赖、路径和文件，多个值之间用英文逗号`,`分隔，例如：

```bash
deplens check -id nodemon,@next/mdx -ip /test,/dist -if /tsconfig.json
```

这个命令与上面的配置文件是完全等价的。

## 更新日志

- 1.0.3
    - 支持解析`.vue`文件
    - 支持在结果输出时显示对应版本号
    - 进一步修复了分析结果显示的unused dependencies数量错误的问题
    - 简化了分析流程，重点分析未使用的依赖，提高了分析效率和结果的准确性
    - 将原`ignore`配置项及`--ignore`命令行参数替换为`ignoreDep`，用于指定要忽略的依赖
    - 新增`--ignorePath`命令行参数及`ignorePath`配置项，用于指定要忽略的路径
    - 新增`--ignoreFile`命令行参数及`ignoreFile`配置项，用于指定要忽略的文件

    - 完善了README

- 1.0.2
    - 修复了全局安装时无法正常运行的致命漏洞
    - 修复了分析结果显示的unused dependencies数量错误的问题
    - 完善了代码注释

- 1.0.1
    - 新增对动态引入的处理
    - 完善了README
- 1.0.0
    - 初始版本。

## 许可证

本项目遵循 MIT 开源协议，允许你在保留版权声明的前提下自由使用、复制、修改和分发本软件。
你可以将 Deplens 用于个人学习、商业项目或其他任何场景，无需支付任何费用，也不承担任何担保责任。
如需查看完整的 MIT 协议条款，请访问 [MIT License](https://opensource.org/licenses/MIT) 官方页面。

## 写在最后

感谢你选择 Deplens，项目目前还处于完善阶段，如果你在使用中遇到了什么问题，欢迎提交 Issue 与 Pull Request，共同完善这款依赖分析工具！