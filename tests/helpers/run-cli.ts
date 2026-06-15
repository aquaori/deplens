import path from "path";
import { spawn } from "child_process";
import { repoRoot } from "./fixtures";

interface CliResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export function runDeplensCli(args: string[]): Promise<CliResult> {
	const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [tsxCli, "src/cli.ts", ...args], {
			cwd: repoRoot,
			env: {
				...process.env,
				FORCE_COLOR: undefined,
				NO_COLOR: "1",
				NODE_OPTIONS: [
					process.env.NODE_OPTIONS || "",
					"-r",
					path.join(repoRoot, "tests", "helpers", "node-compat.cjs"),
				].filter(Boolean).join(" "),
			},
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ code, stdout, stderr });
		});
	});
}
