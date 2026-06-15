const macrosPath = require.resolve("babel-plugin-macros");

export const toolConfig = {
	plugins: ["eslint"],
	presets: ["unused-tool"],
	macrosPath,
};
