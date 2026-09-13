import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FragmentedMp4SegmentAssembler,
  concatenateBytes,
  getFragmentedMp4TrackTimescales,
  getFragmentedMp4VideoFrameCount,
  rebaseFragmentedMp4Media,
  splitFragmentedMp4Initialization,
} from "../../src/shared/fragmented-mp4.ts";
import { buildGameRecorderConcatManifest } from "../../src/shared/game-recorder-concat.ts";
import {
  getGameRecorderEstimatedBufferBytes,
  getGameRecorderCaptureRetryDelay,
  getGameRecorderVideoBitrate,
} from "../../src/shared/game-recorder-quality.ts";
import { resolveGameRecorderPreferences } from "../../src/shared/game-recorder-preferences.ts";
import { isGameWindowDisplaySized } from "../../src/main/services/game-recorder-capture-source.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const makeBox = (type: string, payload = new Uint8Array(0)) => {
  const bytes = new Uint8Array(8 + payload.byteLength);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  for (let index = 0; index < 4; index += 1) {
    bytes[4 + index] = type.charCodeAt(index);
  }
  bytes.set(payload, 8);
  return bytes;
};

const makeTrackInitialization = (
  trackId: number,
  timescale: number,
  handlerType: "vide" | "soun"
) => {
  const tkhdPayload = new Uint8Array(28);
  new DataView(tkhdPayload.buffer).setUint32(12, trackId);
  const mdhdPayload = new Uint8Array(20);
  new DataView(mdhdPayload.buffer).setUint32(12, timescale);
  const hdlrPayload = new Uint8Array(12);
  for (let index = 0; index < 4; index += 1) {
    hdlrPayload[8 + index] = handlerType.charCodeAt(index);
  }
  return makeBox(
    "trak",
    concatenateBytes(
      makeBox("tkhd", tkhdPayload),
      makeBox(
        "mdia",
        concatenateBytes(
          makeBox("mdhd", mdhdPayload),
          makeBox("hdlr", hdlrPayload)
        )
      )
    )
  );
};

const makeTrackFragment = (
  trackId: number,
  decodeTime: bigint,
  sampleCount = 1
) => {
  const tfhdPayload = new Uint8Array(8);
  new DataView(tfhdPayload.buffer).setUint32(4, trackId);
  const tfdtPayload = new Uint8Array(12);
  tfdtPayload[0] = 1;
  new DataView(tfdtPayload.buffer).setBigUint64(4, decodeTime);
  const trunPayload = new Uint8Array(8);
  new DataView(trunPayload.buffer).setUint32(4, sampleCount);
  return {
    bytes: makeBox(
      "traf",
      concatenateBytes(
        makeBox("tfhd", tfhdPayload),
        makeBox("tfdt", tfdtPayload),
        makeBox("trun", trunPayload)
      )
    ),
    // moof header + traf header + tfhd + tfdt full-box header.
    valueOffsetWithinMoof: 8 + 8 + 16 + 12,
  };
};

test("waits for a complete moov and preserves first-event media", () => {
  const ftyp = makeBox("ftyp");
  const moov = makeBox("moov");
  const moof = makeBox("moof");
  const mdat = makeBox("mdat", new Uint8Array([1, 2, 3, 4]));

  assert.equal(splitFragmentedMp4Initialization(ftyp), null);
  const split = splitFragmentedMp4Initialization(
    concatenateBytes(ftyp, moov, moof, mdat)
  );
  assert.ok(split);
  assert.deepEqual(split.initialization, concatenateBytes(ftyp, moov));
  assert.deepEqual(split.media, concatenateBytes(moof, mdat));

  const assembler = new FragmentedMp4SegmentAssembler();
  assert.equal(assembler.push(ftyp), null);
  assert.deepEqual(
    assembler.push(concatenateBytes(moov, moof, mdat)),
    concatenateBytes(ftyp, moov, moof, mdat)
  );
  assert.deepEqual(
    assembler.push(concatenateBytes(moof, mdat)),
    concatenateBytes(ftyp, moov, moof, mdat)
  );
});

test("rebases fragmented MP4 tracks in their own timescales", () => {
  const initialization = concatenateBytes(
    makeBox("ftyp"),
    makeBox(
      "moov",
      concatenateBytes(
        makeTrackInitialization(1, 90_000, "vide"),
        makeTrackInitialization(2, 48_000, "soun")
      )
    )
  );
  const timescales = getFragmentedMp4TrackTimescales(initialization);
  assert.deepEqual(
    [...timescales],
    [
      [1, 90_000],
      [2, 48_000],
    ]
  );

  // Video begins at 3.000s and audio at 3.010s. Subtracting the same raw tick
  // value would destroy that relationship because the clocks differ.
  const video = makeTrackFragment(1, 270_000n, 90);
  const audio = makeTrackFragment(2, 144_480n);
  const media = makeBox("moof", concatenateBytes(video.bytes, audio.bytes));
  rebaseFragmentedMp4Media(media, timescales);

  const view = new DataView(media.buffer, media.byteOffset, media.byteLength);
  const videoOffset = video.valueOffsetWithinMoof;
  const audioOffset =
    8 + video.bytes.byteLength + (audio.valueOffsetWithinMoof - 8);
  assert.equal(view.getBigUint64(videoOffset), 0n);
  assert.equal(view.getBigUint64(audioOffset), 480n);
  assert.equal(
    getFragmentedMp4VideoFrameCount(
      concatenateBytes(initialization, media, makeBox("mdat"))
    ),
    90
  );
});

test("uses exact-window capture unless the client covers its display", () => {
  const display = {
    bounds: { x: 0, y: 0, width: 1_920, height: 1_080 },
    scaleFactor: 1,
  };
  assert.equal(
    isGameWindowDisplaySized(
      { x: 0, y: 0, width: 1_920, height: 1_080 },
      display
    ),
    true
  );
  assert.equal(
    isGameWindowDisplaySized(
      { x: 80, y: 60, width: 1_600, height: 900 },
      display
    ),
    false
  );
  assert.equal(
    isGameWindowDisplaySized(
      { x: 80, y: 60, width: 1_920, height: 1_080 },
      display
    ),
    false
  );
  // Native HWND geometry can be physical pixels while Electron reports DIP.
  assert.equal(
    isGameWindowDisplaySized(
      { x: 0, y: 0, width: 2_880, height: 1_620 },
      { ...display, scaleFactor: 1.5 }
    ),
    true
  );
});

test("quality presets bound recorder bitrate and rolling-disk overhead", () => {
  const base = {
    resolution: "1080p" as const,
    fps: 60 as const,
    captureGameAudio: true,
    replayDurationSeconds: 30 as const,
  };
  const performance = getGameRecorderVideoBitrate(
    { ...base, qualityPreset: "performance" },
    { width: 1_920, height: 1_080 },
    "video/mp4;codecs=avc1"
  );
  const balanced = getGameRecorderVideoBitrate(
    { ...base, qualityPreset: "balanced" },
    { width: 1_920, height: 1_080 },
    "video/mp4;codecs=avc1"
  );
  const quality = getGameRecorderVideoBitrate(
    { ...base, qualityPreset: "quality" },
    { width: 1_920, height: 1_080 },
    "video/mp4;codecs=avc1"
  );
  assert.deepEqual(
    [performance, balanced, quality],
    [22_394_880, 37_324_800, 55_987_200]
  );
  assert.ok(performance < balanced && balanced < quality);
  assert.equal(
    getGameRecorderEstimatedBufferBytes({
      ...base,
      qualityPreset: "quality",
    }),
    253_094_400
  );
});

test("recorder preferences migrate to the high-quality preset safely", () => {
  assert.equal(resolveGameRecorderPreferences(null).qualityPreset, "quality");
  assert.equal(
    resolveGameRecorderPreferences({ gameRecorderQualityPreset: "balanced" })
      .qualityPreset,
    "balanced"
  );
  assert.equal(
    resolveGameRecorderPreferences({
      gameRecorderQualityPreset: "not-a-preset" as "quality",
    }).qualityPreset,
    "quality"
  );
});

test("capture retries back off without abandoning automatic recovery", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 9].map(getGameRecorderCaptureRetryDelay),
    [5_000, 5_000, 10_000, 20_000, 30_000, 30_000]
  );
});

const decodeWithBundledFfmpeg = (inputPath: string) => {
  const ffmpegPath = path.join(repositoryRoot, "ffmpeg", "ffmpeg.exe");
  assert.equal(fs.existsSync(ffmpegPath), true, "Bundled FFmpeg is missing");
  const decode = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 }
  );
  assert.equal(
    decode.status,
    0,
    decode.stderr || decode.stdout || `FFmpeg could not probe ${inputPath}`
  );
};

const decodeAudioWithBundledFfmpeg = (inputPath: string) => {
  const ffmpegPath = path.join(repositoryRoot, "ffmpeg", "ffmpeg.exe");
  const decode = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 }
  );
  assert.equal(
    decode.status,
    0,
    decode.stderr || decode.stdout || `FFmpeg found no audio in ${inputPath}`
  );
};

const getMediaDurationSeconds = (inputPath: string) => {
  const ffmpegPath = path.join(repositoryRoot, "ffmpeg", "ffmpeg.exe");
  const probe = spawnSync(
    ffmpegPath,
    ["-hide_banner", "-i", inputPath, "-f", "null", "-"],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 }
  );
  const diagnostic = `${probe.stderr ?? ""}\n${probe.stdout ?? ""}`;
  const match = diagnostic.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  assert.ok(match, `FFmpeg did not report a duration for ${inputPath}`);
  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
};

test(
  "Electron MP4 slices remain independently probeable and concatenate",
  { skip: process.platform !== "win32", timeout: 45_000 },
  () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gamehub-recorder-test-")
    );
    try {
      const resultPath = path.join(temporaryDirectory, "chunks.json");
      const electronPath = path.join(
        repositoryRoot,
        "node_modules",
        "electron",
        "dist",
        "electron.exe"
      );
      const fixturePath = path.join(
        repositoryRoot,
        "scripts",
        "tests",
        "fixtures",
        "game-recorder-mp4-electron.cjs"
      );
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const benchmarkMode = process.env.GAMEHUB_RECORDER_BENCHMARK === "1";
      const requestedCapture = benchmarkMode
        ? {
            width: 1_920,
            height: 1_080,
            fps: 60,
            bitrate: 55_987_200,
            durationMs: 6_000,
          }
        : {
            width: 640,
            height: 360,
            fps: 30,
            bitrate: 2_000_000,
            durationMs: 4_250,
          };
      const capture = spawnSync(
        electronPath,
        [
          fixturePath,
          resultPath,
          String(requestedCapture.width),
          String(requestedCapture.height),
          String(requestedCapture.fps),
          String(requestedCapture.bitrate),
          String(requestedCapture.durationMs),
        ],
        {
          cwd: repositoryRoot,
          env: environment,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
        }
      );
      assert.equal(
        capture.status,
        0,
        capture.stderr || capture.stdout || "Electron fixture failed"
      );

      const result = JSON.parse(fs.readFileSync(resultPath, "utf8")) as {
        unsupported?: boolean;
        error?: string;
        mimeType?: string;
        chunks?: string[];
        chunkDurationsMs?: number[];
        recorderVideoBitsPerSecond?: number;
        audioContextStateAfterResume?: AudioContextState;
        gpuFeatureStatus?: { video_encode?: string };
        gpuInfo?: {
          gpuDevice?: Array<{
            active?: boolean;
            vendorId?: number;
            deviceId?: number;
          }>;
        };
        videoTrackSettings?: {
          width?: number;
          height?: number;
          frameRate?: number;
        };
      };
      assert.equal(result.unsupported, undefined, "H.264 MP4 is unsupported");
      assert.equal(result.error, undefined, result.error);
      assert.ok(result.chunks && result.chunks.length >= 3);
      assert.equal(result.chunkDurationsMs?.length, result.chunks.length);
      assert.equal(result.recorderVideoBitsPerSecond, requestedCapture.bitrate);
      assert.equal(
        result.audioContextStateAfterResume,
        "running",
        "Hidden recorder AudioContext did not resume without a user gesture"
      );

      const assembler = new FragmentedMp4SegmentAssembler();
      let eventEndedAt = 0;
      let sliceStartedAt = 0;
      const assembled = result.chunks.flatMap((chunk, index) => {
        eventEndedAt += result.chunkDurationsMs?.[index] ?? 700;
        const bytes = assembler.push(
          new Uint8Array(Buffer.from(chunk, "base64"))
        );
        if (!bytes) return [];
        const entry = {
          bytes,
          startedAt: sliceStartedAt,
          endedAt: eventEndedAt,
        };
        sliceStartedAt = eventEndedAt;
        return [entry];
      });
      const segments = assembled.map((entry) => entry.bytes);
      assert.ok(
        segments.length >= 3,
        `Expected at least three media segments, received ${segments.length}`
      );

      const segmentPaths = segments.map((segment, index) => {
        const segmentPath = path.join(
          temporaryDirectory,
          `segment-${index}.mp4`
        );
        fs.writeFileSync(segmentPath, segment);
        decodeWithBundledFfmpeg(segmentPath);
        return segmentPath;
      });
      const encodedFrames = segments.reduce(
        (total, segment) =>
          total + (getFragmentedMp4VideoFrameCount(segment) ?? 0),
        0
      );

      const concatPath = path.join(temporaryDirectory, "segments.ffconcat");
      fs.writeFileSync(
        concatPath,
        buildGameRecorderConcatManifest(
          segmentPaths.map((segmentPath, index) => ({
            path: segmentPath,
            startedAt: assembled[index].startedAt,
            endedAt: assembled[index].endedAt,
          }))
        ),
        "utf8"
      );
      const joinedPath = path.join(temporaryDirectory, "joined.mp4");
      const ffmpegPath = path.join(repositoryRoot, "ffmpeg", "ffmpeg.exe");
      const join = spawnSync(
        ffmpegPath,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-c:v",
          "copy",
          "-c:a",
          "copy",
          joinedPath,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30_000 }
      );
      assert.equal(join.status, 0, join.stderr || join.stdout);
      decodeWithBundledFfmpeg(joinedPath);
      decodeAudioWithBundledFfmpeg(joinedPath);
      const capturedSeconds = assembled.reduce(
        (total, segment) => total + segment.endedAt - segment.startedAt,
        0
      );
      const measuredFps = encodedFrames / (capturedSeconds / 1_000);
      assert.ok(
        measuredFps >= requestedCapture.fps * 0.45 &&
          measuredFps <= requestedCapture.fps + 5,
        `Expected the ${requestedCapture.fps} FPS capture to encode at least 45% of its target, measured ${measuredFps.toFixed(2)}`
      );
      if (process.env.GAMEHUB_RECORDER_BENCHMARK === "1") {
        console.log(
          "RECORDER_BENCHMARK",
          JSON.stringify({
            mimeType: result.mimeType,
            capturedSeconds: Number((capturedSeconds / 1_000).toFixed(3)),
            encodedFrames,
            measuredFps: Number(measuredFps.toFixed(2)),
            requestedVideoBitrate: result.recorderVideoBitsPerSecond,
            videoTrackSettings: result.videoTrackSettings,
            measuredContainerBitrate: Math.round(
              (segments.reduce(
                (total, segment) => total + segment.byteLength,
                0
              ) *
                8) /
                (capturedSeconds / 1_000)
            ),
            gpuVideoEncodeFeature: result.gpuFeatureStatus?.video_encode,
            gpuDevices: result.gpuInfo?.gpuDevice,
          })
        );
      }
      const joinedSeconds = getMediaDurationSeconds(joinedPath);
      assert.ok(
        joinedSeconds <= capturedSeconds / 1_000 + 0.75 &&
          joinedSeconds >= capturedSeconds / 2_000,
        `Joined duration ${joinedSeconds}s was inflated or lost over half of ${(
          capturedSeconds / 1_000
        ).toFixed(3)}s of captured slices`
      );
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);
