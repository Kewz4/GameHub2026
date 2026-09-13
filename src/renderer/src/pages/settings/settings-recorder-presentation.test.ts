import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_GAME_RECORDER_PREFERENCES } from "@shared";
import type { GameRecorderCaptureBackend, GameRecorderState } from "@types";
import { getSettingsRecorderBackendPresentation } from "./settings-recorder-presentation";

const makeRecorderState = (
  overrides: Partial<GameRecorderState> = {}
): GameRecorderState => ({
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
});

const makeDiagnostics = (backend: GameRecorderCaptureBackend) => ({
  backend,
  mimeType: "video/mp4",
  outputWidth: 1920,
  outputHeight: 1080,
  outputFps: 60,
  encodedFps: 60,
  targetVideoBitrate: 56_000_000,
  recentEncodedBitrate: 52_000_000,
  hasAudio: true,
});

describe("desktop recorder settings presentation", () => {
  it("keeps Linux native capture distinct from NVENC and compatibility capture", () => {
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({
          captureActive: true,
          activeCaptureBackend: "native_ffmpeg_x11",
        })
      ),
      "x11_active_pending"
    );
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({
          captureDiagnostics: makeDiagnostics("native_ffmpeg_x11"),
        })
      ),
      "x11_historical"
    );
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({
          captureActive: true,
          activeCaptureBackend: "native_ffmpeg_x11",
          captureDiagnostics: makeDiagnostics("native_ffmpeg_x11"),
        })
      ),
      "x11_active_verified"
    );
  });
  it("labels inactive diagnostics as a historical segment", () => {
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({
          captureDiagnostics: makeDiagnostics("native_ffmpeg_nvenc"),
        })
      ),
      "native_historical"
    );
  });

  it("verifies an active backend only when completed diagnostics match", () => {
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({
          captureActive: true,
          activeCaptureBackend: "native_ffmpeg_nvenc",
          captureDiagnostics: makeDiagnostics("native_ffmpeg_nvenc"),
        })
      ),
      "native_active_verified"
    );
  });

  it("does not present stale native diagnostics as proof after fallback", () => {
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({
          captureActive: true,
          activeCaptureBackend: "media_recorder",
          captureDiagnostics: makeDiagnostics("native_ffmpeg_nvenc"),
        })
      ),
      "compatibility_active_pending"
    );
  });

  it("uses the exact bundled FFmpeg probe only as machine capability", () => {
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({ nativeVideoEncodingAvailable: true })
      ),
      "native_machine_available"
    );
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({ nativeVideoEncodingAvailable: false })
      ),
      "native_machine_unavailable"
    );
  });

  it("keeps unavailable platforms and an unfinished probe distinct", () => {
    assert.equal(
      getSettingsRecorderBackendPresentation(
        makeRecorderState({ status: "unavailable" })
      ),
      "capture_unavailable"
    );
    assert.equal(
      getSettingsRecorderBackendPresentation(null),
      "capability_pending"
    );
  });
});
