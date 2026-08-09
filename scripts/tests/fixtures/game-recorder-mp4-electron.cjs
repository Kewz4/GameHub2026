const fs = require("node:fs");
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
} = require("electron");

const outputPath = process.argv[2];
if (!outputPath) throw new Error("An output path is required.");
const pagePath = `${outputPath}.html`;
const requestedWidth = Number(process.argv[3]) || 640;
const requestedHeight = Number(process.argv[4]) || 360;
const requestedFps = Number(process.argv[5]) || 30;
const requestedBitrate = Number(process.argv[6]) || 2_000_000;
const captureDurationMs = Number(process.argv[7]) || 4_250;
let testWindow;

const finish = (payload) => {
  fs.writeFileSync(outputPath, JSON.stringify(payload), "utf8");
  fs.rmSync(pagePath, { force: true });
  app.quit();
};

ipcMain.once("game-recorder-mp4-result", async (_event, payload) => {
  let veaHistogram = null;
  try {
    testWindow.webContents.debugger.attach("1.3");
    veaHistogram = await testWindow.webContents.debugger.sendCommand(
      "Browser.getHistogram",
      { name: "Media.MediaRecorder.VEAUsed", delta: false }
    );
  } catch {
    // The histogram is diagnostic-only and has changed names in some Chromium
    // releases. The functional recorder test must remain portable.
  } finally {
    if (testWindow?.webContents.debugger.isAttached()) {
      testWindow.webContents.debugger.detach();
    }
  }
  const gpuInfo = await app.getGPUInfo("basic").catch(() => null);
  finish({
    ...payload,
    gpuFeatureStatus: app.getGPUFeatureStatus(),
    gpuInfo,
    veaHistogram,
  });
});

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
  testWindow = window;
  window.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });
      const displays = screen.getAllDisplays();
      const largestDisplay = [...displays].sort(
        (left, right) =>
          right.size.width * right.size.height -
          left.size.width * left.size.height
      )[0];
      const source =
        sources.find(
          (candidate) =>
            candidate.display_id === String(largestDisplay?.id ?? "")
        ) ?? sources[0];
      callback(source ? { video: source } : {});
    },
    { useSystemPicker: false }
  );

  const source = `<!doctype html>
    <script>
      const { ipcRenderer } = require("electron");
      const candidates = [
        'video/mp4;codecs="avc1.640034,mp4a.40.2"',
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
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
          const encodingInfo = navigator.mediaCapabilities?.encodingInfo
            ? await navigator.mediaCapabilities.encodingInfo({
                type: "record",
                video: {
                  contentType: mimeType,
                  width: ${requestedWidth},
                  height: ${requestedHeight},
                  bitrate: ${requestedBitrate},
                  framerate: ${requestedFps},
                },
              }).catch(() => null)
            : null;
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: {
              width: { ideal: ${requestedWidth}, max: ${requestedWidth} },
              height: { ideal: ${requestedHeight}, max: ${requestedHeight} },
              frameRate: { ideal: ${requestedFps}, max: ${requestedFps} },
            },
          });
          // Feed a deterministic, inaudible Web Audio signal into the same
          // MP4 muxer. This exercises the production A/V timescale rebasing and
          // final AAC stream-copy path without playing a test tone aloud.
          const audioContext = new AudioContext({ sampleRate: 48_000 });
          const destination = audioContext.createMediaStreamDestination();
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.frequency.value = 440;
          gain.gain.value = 0.02;
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          const stream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...destination.stream.getAudioTracks(),
          ]);
          const chunks = [];
          const chunkDurationsMs = [];
          const pendingReads = [];
          let previousChunkAt = performance.now();
          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: ${requestedBitrate},
            videoKeyFrameIntervalDuration: 700,
          });
          recorder.addEventListener("dataavailable", (event) => {
            if (!event.data.size) return;
            const chunkAt = performance.now();
            chunkDurationsMs.push(Math.max(1, chunkAt - previousChunkAt));
            previousChunkAt = chunkAt;
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
            displayStream.getTracks().forEach((track) => track.stop());
            oscillator.stop();
            void audioContext.close();
            ipcRenderer.send("game-recorder-mp4-result", {
              error: event.error?.message ?? "MediaRecorder failed",
            });
          });
          recorder.addEventListener("stop", async () => {
            stream.getTracks().forEach((track) => track.stop());
            displayStream.getTracks().forEach((track) => track.stop());
            oscillator.stop();
            await audioContext.close();
            await Promise.all(pendingReads);
            ipcRenderer.send("game-recorder-mp4-result", {
              mimeType: recorder.mimeType || mimeType,
              chunks,
              chunkDurationsMs,
              encodingInfo,
              recorderVideoBitsPerSecond: recorder.videoBitsPerSecond,
              videoTrackSettings: displayStream.getVideoTracks()[0]?.getSettings(),
            });
          });
          recorder.start(700);
          setTimeout(() => recorder.stop(), ${captureDurationMs});
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
