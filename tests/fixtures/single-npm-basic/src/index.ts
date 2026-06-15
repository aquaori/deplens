import lodash from "lodash";

const createDebug = require("debug/src/browser");

export const value = lodash.camelCase("hello world");
createDebug("single-npm-basic");
