import fs from "fs";
import os from "os";
import path from "path";
import { resolvePackageManager } from "../../src/driver/package-manager";

function makeTempProject(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "deplens-package-manager-"));
}

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("resolvePackageManager", () => {
	let tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	it("resolves npm from the nearest package-lock.json", () => {
		const root = makeTempProject();
		tempDirs.push(root);
		const project = path.join(root, "packages", "app");
		fs.mkdirSync(project, { recursive: true });
		writeJson(path.join(root, "package.json"), { name: "root" });
		writeJson(path.join(root, "package-lock.json"), { lockfileVersion: 3 });

		const resolution = resolvePackageManager(project);

		expect(resolution.manager).toBe("npm");
		expect(resolution.lockfilePath).toBe(path.join(root, "package-lock.json"));
		expect(resolution.importerKey).toBe("packages/app");
	});

	it("uses packageManager hint when npm and pnpm lockfiles share a directory", () => {
		const root = makeTempProject();
		tempDirs.push(root);
		writeJson(path.join(root, "package.json"), {
			name: "root",
			packageManager: "pnpm@9.0.0",
		});
		writeJson(path.join(root, "package-lock.json"), { lockfileVersion: 3 });
		fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");

		const resolution = resolvePackageManager(root);

		expect(resolution.manager).toBe("pnpm");
		expect(resolution.importerKey).toBe(".");
	});

	it("prefers the closer lockfile for nested projects", () => {
		const root = makeTempProject();
		tempDirs.push(root);
		const workspace = path.join(root, "workspace");
		const project = path.join(workspace, "package");
		fs.mkdirSync(project, { recursive: true });
		writeJson(path.join(root, "package-lock.json"), { lockfileVersion: 3 });
		fs.writeFileSync(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");

		const resolution = resolvePackageManager(project);

		expect(resolution.manager).toBe("pnpm");
		expect(resolution.lockfilePath).toBe(path.join(workspace, "pnpm-lock.yaml"));
		expect(resolution.importerKey).toBe("package");
	});
});
