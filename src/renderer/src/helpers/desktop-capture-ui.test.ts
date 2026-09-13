import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameRecorderState } from "@types";
import { getDesktopCaptureUiCapabilities } from "./desktop-capture-ui";

const state = (flags: Partial<GameRecorderState>) => flags as GameRecorderState;

test("Linux capture waits for explicit backend capability", () => {
  assert.deepEqual(getDesktopCaptureUiCapabilities(null, "linux"), {
    checking: true,
    screenshots: false,
    systemAudio: false,
  });
  assert.equal(
    getDesktopCaptureUiCapabilities(state({ status: "disabled" }), "linux")
      .screenshots,
    false
  );
});

test("X11 offers screenshots while accurately reporting video-only recording", () => {
  assert.deepEqual(
    getDesktopCaptureUiCapabilities(
      state({
        status: "disabled",
        desktopCaptureAvailable: true,
        systemAudioCaptureAvailable: false,
      }),
      "linux"
    ),
    { checking: false, screenshots: true, systemAudio: false }
  );
});

test("Wayland cannot inherit a saved Windows capture preference", () => {
  assert.deepEqual(
    getDesktopCaptureUiCapabilities(
      state({
        desktopCaptureAvailable: false,
        systemAudioCaptureAvailable: false,
      }),
      "linux"
    ),
    { checking: false, screenshots: false, systemAudio: false }
  );
});

test("Windows supports existing backends but respects an explicit denial", () => {
  assert.equal(
    getDesktopCaptureUiCapabilities(state({}), "win32").systemAudio,
    true
  );
  assert.equal(
    getDesktopCaptureUiCapabilities(
      state({ desktopCaptureAvailable: false }),
      "win32"
    ).screenshots,
    false
  );
});
