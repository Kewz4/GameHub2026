import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OVERLAY_ACTIVATION_GRACE_MS,
  calculateActivationToastBounds,
  canShowActivationToast,
  isOverlayInteractionForeground,
} from "../../src/main/services/overlay-activation-policy.ts";

describe("overlay activation policy", () => {
  it("keeps the ready toast inside wide, medium, and narrow game windows", () => {
    assert.deepEqual(
      calculateActivationToastBounds({ x: 0, y: 0, width: 1920, height: 1080 }),
      { x: 1076, y: 24, width: 820, height: 118 }
    );
    assert.deepEqual(
      calculateActivationToastBounds({
        x: 100,
        y: 50,
        width: 640,
        height: 480,
      }),
      { x: 124, y: 74, width: 592, height: 148 }
    );
    assert.deepEqual(
      calculateActivationToastBounds({
        x: -400,
        y: 0,
        width: 400,
        height: 300,
      }),
      { x: -376, y: 24, width: 352, height: 184 }
    );
  });

  it("caps the toast when the target itself is smaller than the desired toast", () => {
    const target = { x: 12, y: 34, width: 220, height: 150 };
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
  });
});
