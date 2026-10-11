import fs from "fs";
import os from "os";
import path from "path";
import { readAgentProjectConfig } from "../../src/config/project";

describe("Jev experiment configuration", () => {
	let tempDir: string;
	const keys = ["TYPESAFE_API_KEY", "JEV_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_DEFAULT_MODEL"];
	let values: Array<string | undefined>;
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deplens-jev-config-"));
		values = keys.map((key) => process.env[key]);
		keys.forEach((key) => { delete process.env[key]; });
	});
	afterEach(() => {
		keys.forEach((key, index) => { if (values[index] === undefined) delete process.env[key]; else process.env[key] = values[index]; });
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("defaults to LLM and supports explicit Jev selection", () => {
		expect(readAgentProjectConfig(tempDir).review.provider).toBe("llm");
		fs.writeFileSync(path.join(tempDir, "deplens.config.json"), '{"agent":{"review":{"provider":"jev"}}}');
		expect(readAgentProjectConfig(tempDir).review.provider).toBe("jev");
	});

	it("loads decision keys from a synthetic project env and preserves existing environment values", () => {
		fs.writeFileSync(path.join(tempDir, ".env"), 'TYPESAFE_API_KEY=fake-file-key\nJEV_API_KEY=fake-alias\nTYPESAFE_BASE_URL=https://example.invalid\nTYPESAFE_DEFAULT_MODEL=fake-model\n');
		process.env["TYPESAFE_API_KEY"] = "fake-existing-key";
		jest.isolateModules(() => {
			const runtime = require("../../src/config/runtime");
			runtime.initializeRuntimeEnv(tempDir);
			expect(process.env["TYPESAFE_API_KEY"]).toBe("fake-existing-key");
			expect(process.env["JEV_API_KEY"]).toBe("fake-alias");
			expect(process.env["TYPESAFE_DEFAULT_MODEL"]).toBe("fake-model");
			expect(runtime.normalizeCliConfigKey("jevApiKey")).toBeNull();
			expect(runtime.getUserConfigEntries().map((entry: { key: string }) => entry.key)).toEqual(["apiKey", "baseUrl", "model"]);
		});
	});
});
