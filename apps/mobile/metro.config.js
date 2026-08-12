// Expo Metro config tuned for this npm-workspaces monorepo, so Metro finds
// hoisted dependencies at the repo root as well as the app's own node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// NOTE: do NOT set resolver.disableHierarchicalLookup — it breaks resolution of
// React Native's transitive deps (e.g. `promise/...`) in a hoisted workspace.

module.exports = config;
