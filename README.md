# Deplens

[中文文档](./assets/README_cn.md)

![Deplens](./assets/deplens-cli-example.png)

Deplens is a dependency usage analysis tool for Node.js projects. It analyzes `npm` and `pnpm` lockfiles, scans project source code with AST-based static analysis, and helps identify unused dependencies, monorepo workspace dependency issues, and ghost dependency risks with lower false-positive rates than traditional tools.

## Features

- **Automatic Package Manager Detection**: Deplens now detects `npm` or `pnpm` automatically. You no longer need to pass a package-manager flag manually.
- **Monorepo Support**: Deplens can detect npm/pnpm workspaces, analyze each workspace package independently, and report package-level unused dependencies, workspace references, and ghost dependencies.
- **JSON Output**: In addition to human-readable CLI output, Deplens can now export structured JSON reports for CI pipelines, scripts, or custom dashboards.
- **Lockfile-Aware Analysis**: It analyzes `package-lock.json` and `pnpm-lock.yaml` instead of relying only on direct source imports, which reduces false positives caused by nested dependency relationships.
- **Configurable Ignore Rules**: It supports ignored dependencies, paths, and files through both CLI arguments and configuration files.

## Technical Implementation

- Parse `package-lock.json` or `pnpm-lock.yaml`, resolve dependency relationships from lockfile data, and infer whether declared dependencies are actually needed.
- Use `@babel/parser` and `@babel/traverse` to statically analyze project source files and extract import / require usage.
- For monorepos, detect workspace packages from `package.json#workspaces`, `pnpm-workspace.yaml`, or compatible workspace manifests, then analyze each package individually.
- Automatically resolve the nearest applicable lockfile and package manager for both single-project and monorepo package analysis.

## Why Deplens?

Many existing dependency-checking tools only inspect direct imports in application code. That approach often marks dependencies as unused even though they are still required somewhere in the actual dependency graph.

For example, imagine a project that declares:

```json
{
  "dependencies": {
    "react": "19.2.0",
    "react-dom": "19.2.0"
  }
}
```

If a certain part of the code no longer imports `react-dom` directly, some tools may conclude that `react-dom` is unused and can be removed. But that conclusion can be wrong, because dependency relationships inside the lockfile may still make `react-dom` necessary for the project to function correctly.

Deplens tries to solve that problem by combining:

- source-code usage analysis
- lockfile dependency graph analysis
- package-level analysis in monorepos

This makes its results more trustworthy, especially in projects with non-trivial dependency trees.

## Situations that Deplens Cannot Analyze

Deplens is still based on static analysis, so there are cases it cannot fully resolve:

- **Dynamic imports** such as `import(variable)` or `require(variable)`. These are runtime-dependent and cannot always be resolved statically.
- **Non-standard dependency resolution patterns** where a package name is passed through framework-specific or plugin-specific APIs rather than normal `import` / `require` syntax.
- **Alias-like or virtual specifiers** used by some tools and frameworks may still appear as ghost dependencies if they do not map cleanly to real npm package names.

When this happens, you can still fall back to ignore rules through configuration. If you find a pattern that should be supported natively, opening an Issue or Pull Request is the best way to improve Deplens for future releases.

## Installation

```bash
npm install -g @aquaori/deplens
```

This installs Deplens globally so that the `deplens` command can be used anywhere.

If you only want to use it in the current project:

```bash
npm install --save-dev @aquaori/deplens
```

## Usage

```bash
# Show version
deplens -v

# Show help
deplens -h

# Analyze the current project
deplens check
```

Optional parameters:

- `--path` (`-p`): Project path to analyze. Defaults to the current directory.
- `--silence` (`-s`): Silent mode. Suppresses progress bars and normal CLI output.
- `--ignoreDep` (`-id`): Ignore dependencies. Multiple values should be separated by commas.
- `--ignorePath` (`-ip`): Ignore paths. Multiple values should be separated by commas.
- `--ignoreFile` (`-if`): Ignore files. Multiple values should be separated by commas.
- `--config` (`-c`): Path to a custom configuration file.
- `--verbose` (`-V`): Verbose mode. Prints more detailed CLI output.
- `--json` (`-J`): Output the analysis result as JSON.
- `--output` (`-o`): Write the generated report to a file. Works with JSON output and is reserved for future report formats.

Examples:

```bash
# Analyze a specific project
deplens check -p D:\my-project

# Export a JSON report to stdout
deplens check --json

# Export a JSON report to a file
deplens check --json -o deplens-report.json
```

If you installed Deplens as a local dependency instead of globally, use:

```bash
npx @aquaori/deplens check
```

## Configuration File

If you want more control, create a `deplens.config.json` file in the project directory.

### Ignoring Dependencies

Deplens already ignores some common paths by default:

```javascript
["/node_modules/", "/dist/", "/build/", ".git", "*.d.ts"];
```

You can add more ignore rules through configuration:

```json
{
  "ignoreDep": ["nodemon"],
  "ignorePath": ["/test"],
  "ignoreFile": ["/tsconfig.json"]
}
```

You can also point to a custom config file explicitly:

```bash
deplens check -c D:\deplens.config.json
```

Or pass ignore rules directly through CLI arguments:

```bash
deplens check -id nodemon,@next/mdx -ip /test,/dist -if /tsconfig.json
```

## Update Log

- 1.1.0

  - Added automatic package manager detection for both single-package and monorepo analysis.
  - Added monorepo workspace analysis for npm and pnpm workspaces.
  - Added JSON report output with `--json` and file export support through `--output`.
  - Added lockfile resolution based on the nearest applicable workspace package path.
  - Improved CLI output for monorepo mode, including compact package summaries and better progress handling.
  - Fixed BOM-related `package.json` parsing issues in workspace packages.
  - Fixed CLI processes not exiting automatically after analysis.
  - Fixed monorepo output issues caused by dynamic imports being rendered as `undefined`.
  - Reduced noisy non-essential stderr output produced during transpilation.

- 1.0.7

  - Improved `.vue` file analysis support.

- 1.0.6

  - Fixed several CLI and ignore-rule related issues.

- 1.0.5

  - Optimized logger behavior and result output.

- 1.0.4

  - Fixed `.vue` transpilation edge cases.

- 1.0.3

  - Added `.vue` support.
  - Improved output formatting and ignore options.

- 1.0.2

  - Fixed initial release issues.

- 1.0.1

  - Fixed dynamic import parsing issues.

- 1.0.0

  - Initial release.

## License

This project is licensed under the MIT License.

You are free to use, modify, copy, and distribute Deplens in personal or commercial projects as long as the copyright notice is preserved.

For the full license text, see [MIT License](https://opensource.org/licenses/MIT).

## Final Words

Deplens is still evolving. If you run into incorrect results, unsupported patterns, or monorepo edge cases, please open an Issue or Pull Request. Real-world feedback is the fastest way to improve the tool.
