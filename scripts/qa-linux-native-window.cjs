// Isolated Electron window fixture. Only qa-linux-native.cjs launches this.
const { app, BrowserWindow, desktopCapturer } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline");
if (
  process.platform !== "linux" ||
  process.env.GAMEHUB_LINUX_NATIVE_QA !== "1"
) {
  throw new Error(
    "This fixture requires the isolated Linux native QA harness."
  );
}
app.setPath(
  "userData",
  path.join(process.env.GAMEHUB_LINUX_QA_DIRECTORY, "profile")
);
app.commandLine.appendSwitch("disable-dev-shm-usage");
let window;
const reply = (value) =>
  process.stdout.write(`GAMEHUB_QA ${JSON.stringify(value)}\n`);
app.whenReady().then(async () => {
  window = new BrowserWindow({
    x: 100,
    y: 100,
    width: 640,
    height: 360,
    frame: false,
    title: `GameHub Linux native fixture ${process.pid}`,
    backgroundColor: "#123456",
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  await window.loadURL(
    "data:text/html," +
      encodeURIComponent(
        '<body style="margin:0;background:#123456;color:white;font:24px sans-serif"><h1>GameHub Linux native fixture</h1><p>Isolated X11 QA surface</p><canvas id="c" width="200" height="100"></canvas><script>let n=0;const c=document.getElementById("c").getContext("2d");setInterval(()=>{c.fillStyle=`hsl(${n++%360} 80% 50%)`;c.fillRect(0,0,200,100)},33)</script>'
      )
  );
  window.show();
  window.focus();
  reply({
    type: "ready",
    pid: process.pid,
    handle: window.getNativeWindowHandle().readUInt32LE(0),
  });
});
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  try {
    const command = JSON.parse(line);
    if (command.type === "quit") {
      app.quit();
      return;
    }
    if (!window || window.isDestroyed())
      throw new Error("fixture window is not ready");
    if (command.type === "screenshot") {
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(
        path.join(process.env.GAMEHUB_LINUX_QA_DIRECTORY, "window.png"),
        screenshot.toPNG()
      );
      reply({ type: "screenshot", bytes: screenshot.toPNG().length });
    }
    if (command.type === "sources") {
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 640, height: 360 },
      });
      const source = sources.find(
        (item) => item.id.split(":")[1] === String(command.handle)
      );
      if (source && !source.thumbnail.isEmpty())
        fs.writeFileSync(
          path.join(process.env.GAMEHUB_LINUX_QA_DIRECTORY, "capture.png"),
          source.thumbnail.toPNG()
        );
      reply({
        type: "sources",
        exact: Boolean(source),
        nonempty: Boolean(source && !source.thumbnail.isEmpty()),
      });
    }
  } catch (error) {
    reply({ type: "error", message: error.message });
  }
});
