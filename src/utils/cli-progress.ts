import Module from "module";

function patchStringWidthForCliProgress(): void {
	try {
		const resolvedStringWidth = require.resolve("string-width");
		const compatStringWidth = require("string-width-cjs");
		const cachedModule = new Module(resolvedStringWidth);
		cachedModule.filename = resolvedStringWidth;
		cachedModule.loaded = true;
		cachedModule.exports = compatStringWidth;
		require.cache[resolvedStringWidth] = cachedModule;
	} catch {
		// Fall back to the installed resolution path if the compatibility patch cannot be applied.
	}
}

export function loadCliProgress(): typeof import("cli-progress") {
	patchStringWidthForCliProgress();
	return require("cli-progress") as typeof import("cli-progress");
}
