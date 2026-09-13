const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    x: 0,
    y: 0,
    width: 440,
    height: 118,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    focusable: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      partition: `overlay-notification-visual-${Date.now()}`,
    },
  });

  window.removeMenu();
  void window.loadURL("about:blank");
});

app.on("window-all-closed", () => app.quit());
