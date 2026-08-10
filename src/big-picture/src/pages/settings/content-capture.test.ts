import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameRecorderState } from "@types";
import { DEFAULT_GAME_RECORDER_PREFERENCES } from "@shared";

import { getGameRecorderStatusPresentation } from "./content-capture";

function makeState(
  overrides: Partial<GameRecorderState> = {}
): GameRecorderState {
  return {
    status: "waiting",
    configuration: DEFAULT_GAME_RECORDER_PREFERENCES,
    resolvedOutputDirectory: "C:\\Videos\\GameHub",
    recordingStartedAt: null,
    bufferedSeconds: 0,
    captureActive: false,
    activeCaptureBackend: null,
    captureDiagnostics: null,
    hardwareVideoEncodingAvailable: null,
    nativeVideoEncodingAvailable: null,
    gameTitle: null,
    lastSavedClipPath: null,
    statusMessage: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("Big Picture gameplay capture status", () => {
  it("exposes rolling-buffer progress without requiring pointer hover", () => {
    const result = getGameRecorderStatusPresentation(
      makeState({ status: "buffering", bufferedSeconds: 18 })
    );

    assert.equal(result.title, "Instant Replay is buffering");
    assert.match(result.detail, /18 of 30 seconds buffered/);
    assert.equal(result.tone, "success");
  });

  it("reports the verified backend and negotiated output", () => {
    const result = getGameRecorderStatusPresentation(
      makeState({
        status: "ready",
        captureActive: true,
        activeCaptureBackend: "native_ffmpeg_nvenc",
        captureDiagnostics: {
          backend: "native_ffmpeg_nvenc",
          encoderName: "h264_nvenc",
          mimeType: "video/mp4",
          outputWidth: 1920,
          outputHeight: 1080,
          outputFps: 60,
          encodedFps: 59.9,
          targetVideoBitrate: 56_000_000,
          recentEncodedBitrate: 52_000_000,
          hasAudio: true,
        },
      })
    );

    assert.equal(
      result.diagnostics,
      "Active verified · Native NVIDIA NVENC · 1920×1080 · 60 FPS · 56 Mbps target · system audio"
    );
  });

  it("keeps stale diagnostics separate while an alternate backend starts", () => {
    const result = getGameRecorderStatusPresentation(
      makeState({
        status: "buffering",
        captureActive: true,
        activeCaptureBackend: "native_ffmpeg_nvenc",
        captureDiagnostics: {
          backend: "media_recorder",
          mimeType: "video/webm",
          outputWidth: 1280,
          outputHeight: 720,
          outputFps: 30,
          encodedFps: 29.8,
          targetVideoBitrate: 8_000_000,
          recentEncodedBitrate: 7_500_000,
          hasAudio: false,
        },
      })
    );

    assert.equal(
      result.diagnostics,
      "Active Native NVIDIA NVENC · verification pending; last completed segment used Compatibility capture"
    );
    assert.doesNotMatch(result.diagnostics ?? "", /Active verified/);
  });

  it("labels inactive diagnostics as the last completed segment", () => {
    const result = getGameRecorderStatusPresentation(
      makeState({
        captureDiagnostics: {
          backend: "media_recorder",
          mimeType: "video/webm",
          outputWidth: 1920,
          outputHeight: 1080,
          outputFps: 60,
          encodedFps: 58,
          targetVideoBitrate: 24_000_000,
          recentEncodedBitrate: 20_000_000,
          hasAudio: true,
        },
      })
    );

    assert.match(result.diagnostics ?? "", /^Last completed segment/);
  });

  it("reports native encoder capability while backend verification is pending", () => {
    assert.match(
      getGameRecorderStatusPresentation(
        makeState({ nativeVideoEncodingAvailable: true })
      ).diagnostics ?? "",
      /can initialize NVIDIA NVENC/
    );
    assert.match(
      getGameRecorderStatusPresentation(
        makeState({ nativeVideoEncodingAvailable: false })
      ).diagnostics ?? "",
      /NVENC is unavailable/
    );
    assert.match(
      getGameRecorderStatusPresentation(makeState()).diagnostics ?? "",
      /Checking bundled FFmpeg/
    );
  });

  it("surfaces recorder errors as the primary detail", () => {
    const result = getGameRecorderStatusPresentation(
      makeState({ status: "error", errorMessage: "Encoder failed" })
    );

    assert.equal(result.detail, "Encoder failed");
    assert.equal(result.tone, "danger");
  });
});
