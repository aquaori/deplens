# <center> Deplens </center>

![Deplens](https://api.lumirant.top/v1/images/GetImage/GetImageByFileName?filename=deplens-example.jpg)

Deplens 是一个专为 npm 和 pnpm 项目设计的精准依赖使用分析工具，旨在解决传统工具因无法感知 `node_modules` 内部包之间互相引用而导致的误报问题，能够更加精准的分析多种环境下的Nodejs依赖使用情况。

## 核心特性

- **精准分析**：能够利用 pnpm 的非嵌套、内容寻址存储特性，在 pnpm 环境中更准确的识别依赖使用情况。
- **高度兼容性**：同时支持 npm 和 pnpm 两种常用包管理器，支持分析 pnpm-lock.yaml v6 和 v9 两种广泛使用的lockfile版本，同时还支持通过配置文件和命令参数自定义忽略目录。
- **完整依赖图谱**：不仅分析项目源码引用，还递归分析依赖包自身的引用关系。
- **更低的误报概率**：通过构建完整的"依赖使用图谱"，准确判断每个声明的依赖是否真正被使用。

## 技术实现

- 解析 `package-lock.json` 或 `pnpm-lock.yaml` 文件结构，并分析各依赖间的依赖关系，构建完整依赖关系视图
- 使用 `@babel/parser` 和 `@babel/traverse` 对项目源码进行 AST 静态分析
- 通过 BFS/DFS 算法传播依赖使用状态

## 安装

```bash
npm install @aquaori/deplens -g
```

该命令会直接将deplens安装到全局环境中，您可以在任何项目中使用该工具。
如果你只需要在当前项目中使用该工具，而不希望将其安装到全局环境中，您可以使用以下命令：

```bash
npm install @aquaori/deplens --save-dev
```

该命令会将deplens安装到当前项目的`devDependencies`中，您可以在项目的`package.json`文件中查看该依赖。

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
- `--ignore` (`-i`)：指定要忽略的依赖，多个依赖之间用英文逗号`,`分隔
- `--config` (`-c`)：指定自定义配置文件路径
- `--verbose` (`-V`)： 详细模式，将会输出所有分析结果，包括dev依赖

注意：如果你在安装时使用了`--save-dev`参数，而非全局安装，那么你不能直接使用`deplens`命令，而是需要通过以下方式来运行该工具：

```bash
npx @aquaori/deplens check
```

## 配置文件

如果你希望获得更大的自由度，可以在命令运行的目录下创建配置文件：`deplens-config.json`。

### 忽略依赖

配置文件支持自定义忽略依赖：

```json
{
    "ignore": [
        "@prisma/client",
        "nodemon"
    ]
}
```

这样，在命令运行时，就会自动读取目录中的配置文件，并跳过对其中提到的依赖的分析。

或者，你也可以在运行命令时使用`--config`或`-c`参数，指定一个配置文件，它不一定要在当前目录下，也可以在本机的任何地方，例如：

```bash
deplens check -c D:\deplens-config.json
```

又或者，你还可以直接在运行命令时使用`--ignore`或`--i`参数，指定你需要忽略的依赖：

```bash
deplens check -i @prisma/client,nodemen
```

这个命令与上面的配置文件是完全等价的。

## 许可证

本项目遵循 MIT 开源协议，允许您在保留版权声明的前提下自由使用、复制、修改和分发本软件。
您可以将 Deplens 用于个人学习、商业项目或其他任何场景，无需支付任何费用，也不承担任何担保责任。
如需查看完整的 MIT 协议条款，请访问 [MIT License](https://opensource.org/licenses/MIT) 官方页面。

## 写在最后

感谢您选择 Deplens，项目目前还处于完善阶段，如果你在使用中遇到了什么问题，欢迎提交 Issue 与 Pull Request，共同完善这款依赖分析工具！