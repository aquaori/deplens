import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import type { ReviewCoverage, ReviewEvidenceRecord } from "../types";

// This bounded inventory establishes a local inspection scope, not deployment
// coverage. Unsupported inputs and unreadable/truncated files keep it open.
export function collectReviewCoverage(root: string, dependency: string): { coverage: ReviewCoverage; records: ReviewEvidenceRecord[] } {
	const excludedDirectories = ["node_modules", ".git", ".deplens", "dist", "build", "coverage"];
	const coverage: ReviewCoverage = { scope: root, complete: false, checkedFiles: [], excludedDirectories, gaps: [] };
	const records: ReviewEvidenceRecord[] = [];
	let bytes = 0;
	let entries = 0;
	function walk(directory: string): void {
		let children: fs.Dirent[];
		try { children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
		catch { coverage.gaps.push(`unreadable-directory:${path.relative(root, directory)}`); return; }
		for (const child of children) {
			if (++entries > 2000) { coverage.gaps.push("inventory-limit"); return; }
			const absolute = path.join(directory, child.name);
			const relative = path.relative(root, absolute).replace(/\\/g, "/");
			if (child.isSymbolicLink()) { coverage.gaps.push(`symlink:${relative}`); continue; }
			if (child.isDirectory()) {
				if (!excludedDirectories.includes(child.name)) walk(absolute);
				continue;
			}
			// Never open secrets, including project environment files.
			if (/^\.env(?:\.|$)/i.test(child.name) || /\.(pem|key|p12)$/i.test(child.name)) { coverage.gaps.push(`uninspected-private-file:${relative}`); continue; }
			if (/\.(md|txt|png|jpe?g|gif|svg|ico|woff2?|ttf|map)$/i.test(child.name) || /^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|LICENSE|\.gitignore)$/i.test(child.name)) continue;
			const source = /\.[cm]?[jt]sx?$/i.test(child.name);
			if (!source && !/\.json$/i.test(child.name)) { coverage.gaps.push(`unsupported-file:${relative}`); continue; }
			try {
				const size = fs.statSync(absolute).size;
				if (size > 64000 || bytes + size > 128000 || coverage.checkedFiles.length >= 32) { coverage.gaps.push(`inspection-limit:${relative}`); continue; }
				bytes += size;
				let content = fs.readFileSync(absolute, "utf8");
				if (source) parse(content, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] });
				else {
					const data = JSON.parse(content);
					if (child.name === "package.json") {
						for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) delete data[key];
						if (data.workspaces) coverage.gaps.push(`workspace-consumers:${relative}`);
					}
					content = JSON.stringify(data);
				}
				coverage.checkedFiles.push(relative);
				// Target-free consumers also need local classification. Checking only
				// target matches would merely reproduce the scanner's evidence gap.
				records.push({ id: `coverage:${relative}`, kind: "fact", sourceType: "context", filePath: relative,
					summary: `Complete inspected ${source ? "source/config" : "configuration"} file for ${dependency} within the local review scope. Dependency declarations are excluded.`, content });
			} catch { coverage.gaps.push(`read-or-parse-failure:${relative}`); }
		}
	}
	walk(root);
	if (!coverage.checkedFiles.includes("package.json")) coverage.gaps.push("missing-manifest");
	coverage.complete = coverage.gaps.length === 0;
	return { coverage, records };
}
