const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("disable-gpu-sandbox");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: true,
    frame: false,
    backgroundColor: "#070707",
    ...(process.env.GAMEHUB_BACKGROUND_QA === "true"
      ? {
          opacity: 0,
          focusable: false,
          skipTaskbar: true,
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      partition: `overlay-screenshot-${Date.now()}`,
    },
  });
  if (process.env.GAMEHUB_BACKGROUND_QA === "true")
    window.setIgnoreMouseEvents(true);
  window.removeMenu();
  void window.loadURL("about:blank");
});

app.on("window-all-closed", () => app.quit());
