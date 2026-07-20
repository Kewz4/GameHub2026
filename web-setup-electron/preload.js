const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  platform: process.platform,
  getRelease: () => ipcRenderer.invoke("setup:get-release"),
  selectFolder: () => ipcRenderer.invoke("setup:select-folder"),
  install: (release) => ipcRenderer.send("setup:install", release),
  portable: (release, targetDir) =>
    ipcRenderer.send("setup:portable", release, targetDir),
  launch: (targetPath) => ipcRenderer.send("setup:launch", targetPath),
  quit: () => ipcRenderer.send("setup:quit"),
  onProgress: (callback) =>
    ipcRenderer.on("setup:progress", (_e, data) => callback(data)),
  onStatus: (callback) =>
    ipcRenderer.on("setup:status", (_e, data) => callback(data)),
  onDone: (callback) =>
    ipcRenderer.on("setup:done", (_e, data) => callback(data)),
  onError: (callback) =>
    ipcRenderer.on("setup:error", (_e, data) => callback(data)),
});
