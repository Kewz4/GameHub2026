import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateOverlayWindowMode,
  isExactDesktopWindowSource,
} from "./overlay-window-mode";

describe("overlay window-mode eligibility", () => {
  it("allows an exact compositor-backed borderless/windowed HWND", () => {
    assert.deepEqual(
      evaluateOverlayWindowMode({
        platform: "win32",
        targetWindowId: "123456",
        exactWindowSourceAvailable: true,
        displaySized: true,
      }),
      { allowed: true, mode: "windowed-or-borderless" }
    );
  });

  it("explicitly refuses display-sized windows missing compositor evidence", () => {
    assert.deepEqual(
      evaluateOverlayWindowMode({
        platform: "win32",
        targetWindowId: "123456",
        exactWindowSourceAvailable: false,
        displaySized: true,
      }),
      { allowed: false, reason: "exclusive-fullscreen" }
    );
  });

  it("distinguishes an unavailable window source from fullscreen refusal", () => {
    assert.deepEqual(
      evaluateOverlayWindowMode({
        platform: "win32",
        targetWindowId: null,
        exactWindowSourceAvailable: false,
        displaySized: false,
      }),
      { allowed: false, reason: "window-compositor-unavailable" }
    );
  });

  it("matches only the exact window capture source", () => {
    assert.equal(isExactDesktopWindowSource("window:42:0", "42"), true);
    assert.equal(isExactDesktopWindowSource("window:420:0", "42"), false);
    assert.equal(isExactDesktopWindowSource("screen:42:0", "42"), false);
  });

  it("keeps the existing compositor path on non-Windows platforms", () => {
    assert.deepEqual(
      evaluateOverlayWindowMode({
        platform: "linux",
        targetWindowId: null,
        exactWindowSourceAvailable: false,
        displaySized: true,
      }),
      { allowed: true, mode: "windowed-or-borderless" }
    );
  });
});
