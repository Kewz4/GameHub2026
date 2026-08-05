const fs = require("node:fs");
const { app, BrowserWindow, desktopCapturer, ipcMain } = require("electron");

const outputPath = process.argv[2];
if (!outputPath) throw new Error("An output path is required.");
const pagePath = `${outputPath}.html`;

const finish = (payload) => {
  fs.writeFileSync(outputPath, JSON.stringify(payload), "utf8");
  fs.rmSync(pagePath, { force: true });
  app.quit();
};

ipcMain.once("game-recorder-mp4-result", (_event, payload) => finish(payload));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: false,
      nodeIntegration: true,
    },
  });
  window.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      callback(sources[0] ? { video: sources[0] } : {});
    },
    { useSystemPicker: false }
  );

  const source = `<!doctype html>
    <script>
      const { ipcRenderer } = require("electron");
      const candidates = [
        'video/mp4;codecs="avc1.640034"',
        'video/mp4;codecs="avc1.42E01E"',
        'video/mp4'
      ];
      const mimeType = candidates.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      );
      if (!mimeType) {
        ipcRenderer.send("game-recorder-mp4-result", { unsupported: true });
      } else {
        (async () => {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: {
              width: { ideal: 640, max: 640 },
              height: { ideal: 360, max: 360 },
              frameRate: { ideal: 30, max: 30 },
            },
          });
          const chunks = [];
          const pendingReads = [];
          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 2_000_000,
            videoKeyFrameIntervalDuration: 700,
          });
          recorder.addEventListener("dataavailable", (event) => {
            if (!event.data.size) return;
            const index = chunks.length;
            chunks.push(null);
            pendingReads.push(
              event.data.arrayBuffer().then((payload) => {
                chunks[index] = Buffer.from(payload).toString("base64");
              })
            );
          });
          recorder.addEventListener("error", (event) => {
            stream.getTracks().forEach((track) => track.stop());
            ipcRenderer.send("game-recorder-mp4-result", {
              error: event.error?.message ?? "MediaRecorder failed",
            });
          });
          recorder.addEventListener("stop", async () => {
            stream.getTracks().forEach((track) => track.stop());
            await Promise.all(pendingReads);
            ipcRenderer.send("game-recorder-mp4-result", {
              mimeType: recorder.mimeType || mimeType,
              chunks,
            });
          });
          recorder.start(700);
          setTimeout(() => recorder.stop(), 4_250);
        })().catch((error) => {
          ipcRenderer.send("game-recorder-mp4-result", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    </script>`;

  fs.writeFileSync(pagePath, source, "utf8");
  await window.loadFile(pagePath);
});

setTimeout(
  () => finish({ error: "Electron recorder fixture timed out" }),
  15_000
);
