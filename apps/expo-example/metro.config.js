// The app lives in the Cutiva monorepo and uses @cutiva/expo and @cutiva/core from packages/ as
// linked folders, so Metro watches them and resolves their dependencies from the repo root too.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(root, "packages")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules"), path.join(root, "node_modules")];
module.exports = config;
