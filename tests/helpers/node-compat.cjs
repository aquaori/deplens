const Module = require("module");

const originalLoad = Module._load;

// strip-ansi@6 在部分解析路径下会被当成 ESM 命名空间返回，这里统一成可调用的函数。
Module._load = function patchedLoad(request, _parent, _isMain) {
	const loaded = originalLoad.apply(this, arguments);
	if (
		request === "strip-ansi"
		&& loaded
		&& typeof loaded !== "function"
		&& typeof loaded.default === "function"
	) {
		return loaded.default;
	}
	return loaded;
};
