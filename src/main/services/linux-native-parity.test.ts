import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { supportsGameProcessControl } from "./game-process-control-capability";
import { evaluateOverlayWindowMode } from "./overlay-window-mode";
import { supportsDesktopGameCapture } from "./desktop-capture-capability";

test("automatic capture is scoped to X11 and never silently opens a Wayland portal", () => {
  assert.equal(
    supportsDesktopGameCapture("linux", {
      DISPLAY: ":0",
      XDG_SESSION_TYPE: "x11",
    }),
    true
  );
  assert.equal(supportsDesktopGameCapture("linux", {}), false);
  assert.equal(
    supportsDesktopGameCapture("linux", {
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
    }),
    false
  );
  assert.equal(
    supportsDesktopGameCapture("linux", {
      DISPLAY: ":0",
      XDG_SESSION_TYPE: "wayland",
    }),
    false
  );
  assert.equal(supportsDesktopGameCapture("win32", {}), true);
});

test("Linux exposes process controls while unsupported platforms do not", () => {
  assert.equal(supportsGameProcessControl("linux"), true);
  assert.equal(supportsGameProcessControl("win32"), true);
  assert.equal(supportsGameProcessControl("darwin"), false);
});

test("Linux overlay requires a real composited target; Wayland unknown is not success", () => {
  assert.deepEqual(
    evaluateOverlayWindowMode({
      platform: "linux",
      targetWindowId: null,
      exactWindowSourceAvailable: false,
      displaySized: true,
    }),
    { allowed: false, reason: "window-compositor-unavailable" }
  );
  assert.deepEqual(
    evaluateOverlayWindowMode({
      platform: "linux",
      targetWindowId: "1234",
      desktopCompositionAvailable: true,
      exactWindowSourceAvailable: true,
      displaySized: true,
    }),
    { allowed: true, mode: "windowed-or-borderless" }
  );
});

test("Linux runtime adapters are wired rather than dead native code", () => {
  const source = readFileSync(
    new URL("./native-addon.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /process\.platform === "linux"\) return linuxAudioMixer\.getSessions\(\)/
  );
  const manager = readFileSync(
    new URL("./game-process-control-manager.ts", import.meta.url),
    "utf8"
  );
  assert.match(manager, /supportsGameProcessControl\(process\.platform\)/);
  assert.match(manager, /hasPausedProcessIdentity\(\)/);
  const notifications = readFileSync(
    new URL("./window-manager.ts", import.meta.url),
    "utf8"
  );
  assert.match(notifications, /NativeAddon\.isDesktopCompositionAvailable\(\)/);
  const recorder = readFileSync(
    new URL("./game-recorder-manager.ts", import.meta.url),
    "utf8"
  );
  assert.match(recorder, /probeLinuxRecorder\(this\.resolveFfmpegPath\(\)\)/);
  assert.match(recorder, /native_ffmpeg_x11/);
});
