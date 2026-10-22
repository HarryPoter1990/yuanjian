// The staging app has complete JS bundles, with only Electron and Node builtins left external.
// electron-builder's false hook result prevents fallback collection of the development node_modules.
module.exports = async () => false;
