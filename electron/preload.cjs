const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getVersion: () => process.env.npm_package_version || "0.1.0",
});
