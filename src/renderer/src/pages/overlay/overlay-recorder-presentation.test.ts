import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as presentationModule from "./overlay-recorder-presentation.ts";

const { getOverlayReplayPresentation, getOverlayRecorderTechnicalSummary } =
  presentationModule;

describe("overlay instant replay presentation", () => {
  it("shows the selected target and actual partial buffer together", () => {
    assert.deepEqual(getOverlayReplayPresentation(30, 45), {
      availableSeconds: 30,
      bufferLabel: "30s of 45s buffered",
      isReady: false,
      progressPercent: (30 / 45) * 100,
      saveLabel: "Save 30s available",
      statusLabel: "Buffering Instant Replay",
    });
  });

  it("uses the selected duration once that much gameplay is ready", () => {
    assert.deepEqual(getOverlayReplayPresentation(47.8, 45), {
      availableSeconds: 45,
      bufferLabel: "45s ready",
      isReady: true,
      progressPercent: 100,
      saveLabel: "Save last 45s",
      statusLabel: "Instant Replay is ready",
    });
  });

  it("does not claim readiness for invalid or empty buffer values", () => {
    assert.deepEqual(getOverlayReplayPresentation(Number.NaN, 60), {
      availableSeconds: 0,
      bufferLabel: "0s of 60s buffered",
      isReady: false,
      progressPercent: 0,
      saveLabel: "Save 0s available",
      statusLabel: "Buffering Instant Replay",
    });
  });
});

describe("overlay recorder technical summary", () => {
  it("distinguishes negotiated capture settings from encoded throughput", () => {
    assert.equal(
      getOverlayRecorderTechnicalSummary(
        {
          mimeType: 'video/mp4;codecs="avc1.640034,mp4a.40.2"',
          outputWidth: 1920,
          outputHeight: 1080,
          outputFps: 59.94,
          encodedFps: 31.02,
          targetVideoBitrate: 56_000_000,
          recentEncodedBitrate: 18_500_000,
          hasAudio: true,
        },
        { resolution: "1080p", fps: 60, qualityPreset: "quality" }
      ),
      "High · H.264 · 1080p · 31.0 FPS encoded · 18.5 Mbps"
    );
  });

  it("labels unstarted capture as requested rather than delivered", () => {
    assert.equal(
      getOverlayRecorderTechnicalSummary(null, {
        resolution: "1440p",
        fps: 120,
        qualityPreset: "balanced",
      }),
      "Balanced · 1440p · 120 FPS requested"
    );
  });
});
