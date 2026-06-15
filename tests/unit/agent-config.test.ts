import fs from "fs";
import os from "os";
import path from "path";
import { readAgentProjectConfig } from "../../src/config/project";

describe("agent project config", () => {
	it("reads review and telemetry overrides from deplens.config.json", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-config-"));
		fs.writeFileSync(path.join(tempDir, "deplens.config.json"), JSON.stringify({
			agent: {
				output: { strictValidation: false },
				memory: { enabled: false, maxEntries: 12 },
				review: {
					maxRounds: 6,
					knowledge: { enabled: false, maxHits: 3 },
					confidence: {
						staticWeight: 1.2,
						modelWeight: 0.9,
						knowledgeWeight: 0.3,
						conservativeMargin: 0.12,
					},
				},
				telemetry: {
					enabled: false,
					maxRuns: 25,
				},
			},
		}, null, 2), "utf8");

		const config = readAgentProjectConfig(tempDir);
		expect(config).toMatchObject({
			output: { strictValidation: false },
			memory: { enabled: false, maxEntries: 12 },
			review: {
				maxRounds: 6,
				knowledge: { enabled: false, maxHits: 3 },
				confidence: {
					staticWeight: 1.2,
					modelWeight: 0.9,
					knowledgeWeight: 0.3,
					conservativeMargin: 0.12,
				},
			},
			telemetry: {
				enabled: false,
				maxRuns: 25,
			},
		});
	});
});
