import path from "path";

export const repoRoot = path.resolve(__dirname, "../..");
export const fixturesRoot = path.join(repoRoot, "tests", "fixtures");

export function fixturePath(name: string): string {
	return path.join(fixturesRoot, name);
}
