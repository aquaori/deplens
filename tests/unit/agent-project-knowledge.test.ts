import fs from "fs";
import os from "os";
import path from "path";
import { searchProjectKnowledge, syncProjectKnowledgeStore } from "../../src/agent/project-knowledge";

describe("project knowledge", () => {
	it("indexes README and returns dependency-specific hits", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-knowledge-"));
		fs.writeFileSync(
			path.join(tempDir, "README.md"),
			[
				"# Demo",
				"",
				"@babel/preset-react is used by the build pipeline and start scripts.",
				"",
				"Keep it even when no direct import exists.",
			].join("\n"),
			"utf8"
		);

		const store = syncProjectKnowledgeStore(tempDir);
		const hits = searchProjectKnowledge(tempDir, {
			dependencyName: "@babel/preset-react",
			signalRoles: ["script"],
		});

		expect(store.files.length).toBe(1);
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.chunk.filePath).toBe("README.md");
	});
});
