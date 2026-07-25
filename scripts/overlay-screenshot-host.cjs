const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("disable-gpu-sandbox");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: true,
    frame: false,
    backgroundColor: "#070707",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      partition: `overlay-screenshot-${Date.now()}`,
    },
  });
  window.removeMenu();
  void window.loadURL("about:blank");
});

app.on("window-all-closed", () => app.quit());
