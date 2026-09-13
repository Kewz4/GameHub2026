import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OVERLAY_ACTIVATION_GRACE_MS,
  calculateActivationToastBounds,
  canShowActivationToast,
  isOverlayInteractionForeground,
} from "../../src/main/services/overlay-activation-policy.ts";

describe("overlay activation policy", () => {
  it("anchors the ready toast to the game window's right edge", () => {
    assert.deepEqual(
      calculateActivationToastBounds({ x: 0, y: 0, width: 1920, height: 1080 }),
      { x: 1480, y: 24, width: 440, height: 64 }
    );
    assert.deepEqual(
      calculateActivationToastBounds({
        x: 100,
        y: 50,
        width: 640,
        height: 480,
      }),
      { x: 300, y: 74, width: 440, height: 64 }
    );
    const wide = calculateActivationToastBounds({
      x: 80,
      y: 40,
      width: 1920,
      height: 1080,
    });
    assert.equal(
      80 + 1920 - (wide.x + wide.width),
      0,
      "the toast host must share the game window's right coordinate"
    );
    const negativeMonitor = calculateActivationToastBounds({
      x: -1920,
      y: -120,
      width: 1280,
      height: 720,
    });
    assert.equal(
      -1920 + 1280 - (negativeMonitor.x + negativeMonitor.width),
      0,
      "negative monitor coordinates retain the same right-edge anchor"
    );
    assert.deepEqual(
      calculateActivationToastBounds({
        x: -340,
        y: 0,
        width: 340,
        height: 300,
      }),
      { x: -316, y: 24, width: 316, height: 82 }
    );
  });

  it("reserves only the extra height the error copy needs", () => {
    const target = { x: -1440, y: 60, width: 1440, height: 900 };
    assert.deepEqual(calculateActivationToastBounds(target, "ready"), {
      x: -440,
      y: 84,
      width: 440,
      height: 64,
    });
    assert.deepEqual(calculateActivationToastBounds(target, "error"), {
      x: -440,
      y: 84,
      width: 440,
      height: 80,
    });
  });

  it("caps the toast when the target itself is smaller than the desired toast", () => {
    const target = { x: 12, y: 34, width: 220, height: 50 };
    const toast = calculateActivationToastBounds(target);

    assert.equal(toast.height, target.height);
    assert.ok(toast.x >= target.x);
    assert.ok(toast.y >= target.y);
    assert.ok(toast.x + toast.width <= target.x + target.width);
    assert.ok(toast.y + toast.height <= target.y + target.height);
  });

  it("bridges only the ambiguous Electron focus hand-off", () => {
    const now = 10_000;
    const base = {
      targetPid: 20,
      foregroundPid: 20,
      appPid: 10,
      overlayVisible: true,
      overlayFocused: false,
      activationGraceUntil: now + OVERLAY_ACTIVATION_GRACE_MS,
      now,
    };

    assert.equal(isOverlayInteractionForeground(base), true);
    assert.equal(
      isOverlayInteractionForeground({ ...base, foregroundPid: 10 }),
      true
    );
    assert.equal(
      isOverlayInteractionForeground({ ...base, foregroundPid: 0 }),
      true
    );
    assert.equal(
      isOverlayInteractionForeground({ ...base, foregroundPid: 99 }),
      false,
      "Alt+Tab to another process must hide immediately"
    );
    assert.equal(
      isOverlayInteractionForeground({
        ...base,
        foregroundPid: 10,
        now: base.activationGraceUntil + 1,
      }),
      false,
      "the Electron-PID exception must expire"
    );
  });

  it("never treats a hidden or targetless overlay as foreground", () => {
    const base = {
      targetPid: 20,
      foregroundPid: 10,
      appPid: 10,
      overlayVisible: true,
      overlayFocused: true,
      activationGraceUntil: 1_000,
      now: 500,
    };

    assert.equal(
      isOverlayInteractionForeground({ ...base, targetPid: 0 }),
      false
    );
    assert.equal(
      isOverlayInteractionForeground({
        ...base,
        overlayVisible: false,
        overlayFocused: false,
      }),
      false
    );
  });

  it("shows the notification only after the full renderer is ready", () => {
    assert.equal(canShowActivationToast(true, false, false), false);
    assert.equal(canShowActivationToast(true, false, true), true);
    assert.equal(canShowActivationToast(true, true, true), false);
    assert.equal(canShowActivationToast(false, false, true), false);
    assert.equal(
      canShowActivationToast(true, false, true, false),
      false,
      "disabled input isolation must not advertise an unusable shortcut"
    );
  });
});
