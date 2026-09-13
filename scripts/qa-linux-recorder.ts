import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_GAME_RECORDER_PREFERENCES } from "../src/shared";
import { NativeRecorderSession } from "../src/main/services/game-recorder-native-session";
import { probeLinuxRecorder } from "../src/main/services/linux-recorder-ffmpeg";
import { linuxAudioMixer } from "../src/main/services/linux-audio-mixer";

const execFileAsync = promisify(execFile);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  assert.equal(process.platform, "linux");
  assert.equal(process.env.GAMEHUB_LINUX_NATIVE_QA, "1");
  const [windowId, directory] = process.argv.slice(2);
  assert.ok(/^\d+$/.test(windowId));
  const artifactRoot = path.resolve(
    import.meta.dirname,
    "../artifacts/linux-parity"
  );
  const relative = path.relative(artifactRoot, path.resolve(directory));
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
  fs.mkdirSync(directory, { recursive: true });
  const capability = await probeLinuxRecorder("ffmpeg");
  assert.equal(
    capability.available,
    true,
    "real FFmpeg X11/libx264 is required"
  );
  const modules: string[] = [];
  let tone: ReturnType<typeof spawn> | null = null;
  let session: NativeRecorderSession | null = null;
  const report: Record<string, unknown> = {
    capability,
    smokeEncoder: "libx264",
  };
  try {
    // Create a private null sink, never change the user's default output or mic.
    const sinkName = `gamehub_qa_${process.pid}`;
    const { stdout: module } = await execFileAsync("pactl", [
      "load-module",
      "module-null-sink",
      `sink_name=${sinkName}`,
    ]);
    const moduleId = module.trim();
    assert.ok(/^\d+$/.test(moduleId));
    modules.push(moduleId);
    const { stdout: sinks } = await execFileAsync("pactl", [
      "--format=json",
      "list",
      "sinks",
    ]);
    const { stdout: sources } = await execFileAsync("pactl", [
      "--format=json",
      "list",
      "sources",
    ]);
    const { selectPulseMonitorSource } = await import(
      "../src/main/services/linux-audio-mixer"
    );
    const monitor = selectPulseMonitorSource(
      sinkName,
      JSON.parse(sinks),
      JSON.parse(sources)
    );
    assert.ok(monitor, "the private output sink must have a real monitor");
    tone = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-f",
        "pulse",
        "-device",
        sinkName,
        "GameHub QA tone",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    const toneErrors: string[] = [];
    tone.stderr?.on("data", (chunk) => toneErrors.push(String(chunk)));
    const segments: string[] = [];
    let failure: string | null = null;
    session = new NativeRecorderSession({
      ffmpegPath: "ffmpeg",
      encoder: "h264_nvenc",
      linux: { display: process.env.DISPLAY!, pulseMonitor: monitor },
      configuration: {
        ...DEFAULT_GAME_RECORDER_PREFERENCES,
        resolution: "source",
        fps: 30,
        captureGameAudio: true,
      },
      captureSessionId: 1,
      windowHandle: windowId,
      sourceWidth: 640,
      sourceHeight: 360,
      segmentDirectory: directory,
      onSegment: (segment) => {
        segments.push(segment.path);
      },
      onFatalError: (message) => {
        failure = message;
      },
    });
    session.start();
    const deadline = Date.now() + 20000;
    while (!segments.length && !failure && Date.now() < deadline)
      await delay(100);
    assert.equal(failure, null, `native capture failed: ${failure}`);
    assert.ok(
      segments.length,
      `no completed native segment; tone errors: ${toneErrors.join("\n")}`
    );
    await session.stop();
    session = null;
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      segments[0],
    ]);
    const metadata = JSON.parse(stdout);
    assert.ok(
      metadata.streams.some(
        (stream: { codec_type: string; width: number; height: number }) =>
          stream.codec_type === "video" &&
          stream.width === 640 &&
          stream.height === 360
      )
    );
    assert.ok(
      metadata.streams.some(
        (stream: { codec_type: string }) => stream.codec_type === "audio"
      )
    );
    const measured = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-i",
        segments[0],
        "-af",
        "volumedetect",
        "-vn",
        "-f",
        "null",
        "/dev/null",
      ],
      { maxBuffer: 1024 * 1024 }
    );
    const mean = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(measured.stderr);
    assert.ok(
      mean && Number(mean[1]) > -80,
      "recorded monitor audio must not be silent"
    );
    // Exercise the same production async mixer against the owned tone stream.
    const sessions = await linuxAudioMixer.getSessions();
    const toneSession = sessions.find((item) => item.pid === tone!.pid);
    assert.ok(
      toneSession,
      "private tone stream must expose its process identity"
    );
    assert.equal(await linuxAudioMixer.setVolume(toneSession.pid, 0.25), true);
    assert.equal(await linuxAudioMixer.setMute(toneSession.pid, true), true);
    assert.equal(await linuxAudioMixer.setMute(toneSession.pid, false), true);
    report.success = true;
    report.metadata = metadata;
    report.audioMeanDb = Number(mean[1]);
    report.mixerProcess = toneSession.pid;
  } finally {
    if (session) await session.stop();
    tone?.kill();
    for (const module of modules)
      await execFileAsync("pactl", ["unload-module", module]).catch(
        () => undefined
      );
    fs.writeFileSync(
      path.join(directory, "recorder-report.json"),
      JSON.stringify(report, null, 2)
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
