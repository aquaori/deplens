import fs from "fs";
import path from "path";

export type PackageManager = "npm" | "pnpm";

export interface PackageManagerResolution {
	manager: PackageManager;
	lockfilePath: string;
	lockfileDir: string;
	importerKey: string;
}

function getWorkspaceYamlPath(projectPath: string): string | null {
	const candidates = ["pnpm-workspace.yaml", "pnpm-monorepo.yaml"];
	for (const candidate of candidates) {
		const fullPath = path.join(projectPath, candidate);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}
	return null;
}

function findNearestUp(startPath: string, fileName: string): string | null {
	let currentPath = path.resolve(startPath);

	while (true) {
		const targetPath = path.join(currentPath, fileName);
		if (fs.existsSync(targetPath)) {
			return targetPath;
		}

		const parentPath = path.dirname(currentPath);
		if (parentPath === currentPath) {
			return null;
		}
		currentPath = parentPath;
	}
}

function getNearestPackageManagerHint(startPath: string): PackageManager | null {
	const packageJsonPath = findNearestUp(startPath, "package.json");
	if (!packageJsonPath) return null;

	try {
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
			packageManager?: string;
		};
		if (typeof packageJson.packageManager !== "string") return null;
		if (packageJson.packageManager.startsWith("pnpm@")) return "pnpm";
		if (packageJson.packageManager.startsWith("npm@")) return "npm";
	} catch {
		return null;
	}

	return null;
}

export function resolvePackageManager(projectPath: string): PackageManagerResolution {
	const absoluteProjectPath = path.resolve(projectPath);
	const npmLockPath = findNearestUp(absoluteProjectPath, "package-lock.json");
	const pnpmLockPath = findNearestUp(absoluteProjectPath, "pnpm-lock.yaml");

	if (!npmLockPath && !pnpmLockPath) {
		throw new Error(
			`No supported lockfile was found for ${absoluteProjectPath}. Expected package-lock.json or pnpm-lock.yaml.`
		);
	}

	let manager: PackageManager;
	let lockfilePath: string;

	if (npmLockPath && !pnpmLockPath) {
		manager = "npm";
		lockfilePath = npmLockPath;
	} else if (!npmLockPath && pnpmLockPath) {
		manager = "pnpm";
		lockfilePath = pnpmLockPath;
	} else {
		const npmDir = path.dirname(npmLockPath as string);
		const pnpmDir = path.dirname(pnpmLockPath as string);
		const npmDistance = path.relative(npmDir, absoluteProjectPath).split(path.sep).length;
		const pnpmDistance = path.relative(pnpmDir, absoluteProjectPath).split(path.sep).length;

		if (npmDir === pnpmDir) {
			const hintedManager = getNearestPackageManagerHint(absoluteProjectPath);
			if (hintedManager === "pnpm" || getWorkspaceYamlPath(pnpmDir)) {
				manager = "pnpm";
				lockfilePath = pnpmLockPath as string;
			} else {
				manager = "npm";
				lockfilePath = npmLockPath as string;
			}
		} else if (pnpmDistance < npmDistance) {
			manager = "pnpm";
			lockfilePath = pnpmLockPath as string;
		} else {
			manager = "npm";
			lockfilePath = npmLockPath as string;
		}
	}

	const lockfileDir = path.dirname(lockfilePath);
	const importerRelativePath = path.relative(lockfileDir, absoluteProjectPath).replace(/\\/g, "/");

	return {
		manager,
		lockfilePath,
		lockfileDir,
		importerKey: importerRelativePath === "" ? "." : importerRelativePath,
	};
}

export function isPnpmWorkspace(projectPath: string): boolean {
	return Boolean(getWorkspaceYamlPath(projectPath));
}
