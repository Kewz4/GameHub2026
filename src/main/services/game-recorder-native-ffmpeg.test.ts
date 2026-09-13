import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_GAME_RECORDER_PREFERENCES } from "../../shared";
import {
  buildNativeRecorderFfmpegArguments,
  getNativeRecorderInitialAudioPaddingFrames,
  normalizeNativeRecorderWindowHandle,
  parseNativeRecorderSegmentListEntry,
} from "./game-recorder-native-ffmpeg";

describe("native game recorder FFmpeg contract", () => {
  it("builds a zero-copy NVENC exact-window pipeline with one-pass audio", () => {
    const result = buildNativeRecorderFfmpegArguments({
      configuration: {
        ...DEFAULT_GAME_RECORDER_PREFERENCES,
        enabled: true,
        instantReplayEnabled: true,
      },
      encoder: "h264_nvenc",
      ffmpegWindowHandle: "198316",
      sourceWidth: 1_680,
      sourceHeight: 1_050,
      outputPattern: "C:\\Temp\\recorder\\native-%08d.mp4",
      includeAudio: true,
    });

    assert.deepEqual(result.dimensions, { width: 1_920, height: 1_080 });
    assert.ok(result.targetBitrate >= 50_000_000);
    assert.ok(
      result.args.includes(
        "gfxcapture=hwnd=198316:max_framerate=60:capture_cursor=0:capture_border=0:display_border=0:resize_mode=scale_aspect:scale_mode=bicubic:width=1920:height=1080"
      )
    );
    assert.ok(result.args.includes("h264_nvenc"));
    assert.ok(result.args.includes("f32le"));
    assert.ok(result.args.includes("aac"));
    assert.ok(result.args.includes("pipe:0"));
    assert.equal(result.args.at(-1), "C:\\Temp\\recorder\\native-%08d.mp4");
  });

  it("keeps source output even-sized and omits audio when disabled", () => {
    const result = buildNativeRecorderFfmpegArguments({
      configuration: {
        ...DEFAULT_GAME_RECORDER_PREFERENCES,
        resolution: "source",
        captureGameAudio: false,
      },
      encoder: "h264_nvenc",
      ffmpegWindowHandle: "42",
      sourceWidth: 1_919,
      sourceHeight: 1_079,
      outputPattern: "native-%08d.mp4",
      includeAudio: false,
    });

    assert.deepEqual(result.dimensions, { width: 1_918, height: 1_078 });
    assert.equal(result.args.includes("f32le"), false);
    assert.equal(result.args.includes("aac"), false);
  });

  it("rejects non-decimal or null window handles before Lavfi interpolation", () => {
    assert.throws(() => normalizeNativeRecorderWindowHandle("0"));
    assert.throws(() =>
      normalizeNativeRecorderWindowHandle("123:movie=malicious")
    );
    assert.equal(normalizeNativeRecorderWindowHandle(" 987654 "), "987654");
  });

  it("parses completed segment CSV lines, including quoted comma paths", () => {
    assert.deepEqual(
      parseNativeRecorderSegmentListEntry(
        '"C:\\Users\\K, Test\\segment-00001.mp4",3.050000,6.050000'
      ),
      {
        path: "C:\\Users\\K, Test\\segment-00001.mp4",
        startSeconds: 3.05,
        endSeconds: 6.05,
      }
    );
    assert.equal(parseNativeRecorderSegmentListEntry("segment.mp4,6,6"), null);
  });

  it("preserves the bounded native-video to loopback-audio startup gap", () => {
    assert.equal(
      getNativeRecorderInitialAudioPaddingFrames(1_000, 1_250, 48_000),
      12_000
    );
    assert.equal(
      getNativeRecorderInitialAudioPaddingFrames(1_000, 500, 48_000),
      0
    );
    assert.equal(
      getNativeRecorderInitialAudioPaddingFrames(0, 60_000, 48_000),
      480_000
    );
  });
});
