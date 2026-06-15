const Module = require("module");
const path = require("path");

const originalLoad = Module._load;

function loadPnpmFallback(request) {
	if (request === "@jridgewell/source-map") {
		return require(path.join(process.cwd(), "node_modules", ".pnpm", "node_modules", "@jridgewell", "source-map"));
	}
	return null;
}

Module._load = function patchedLoad(request, parent, isMain) {
	try {
		const loaded = originalLoad.apply(this, arguments);
		if (request === "strip-ansi" && loaded && typeof loaded !== "function" && typeof loaded.default === "function") {
			return loaded.default;
		}
		return loaded;
	} catch (error) {
		if (error && error.code === "MODULE_NOT_FOUND") {
			const fallback = loadPnpmFallback(request);
			if (fallback) {
				return fallback;
			}
		}
		throw error;
	}
};
