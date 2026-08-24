import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateExpectedOverlayRefusal,
  isSyntheticFocusExplicitlyAllowed,
  LIVE_OVERLAY_QA_MODE,
  parseLiveOverlayQaMode,
  SYNTHETIC_FOCUS_ACKNOWLEDGEMENT,
} from "../qa-live-overlay-policy.mjs";

const refusal = (overrides = {}) =>
  evaluateExpectedOverlayRefusal({
    mode: LIVE_OVERLAY_QA_MODE.expectRefusal,
    overlayVisible: false,
    gateReason: null,
    accessBlocked: false,
    moduleBlocked: false,
    unsupportedModuleMask: 0,
    liveInputKillSwitchConfirmed: true,
    ...overrides,
  });

describe("live overlay QA policy", () => {
  it("requires one explicit non-interactive mode", () => {
    assert.equal(parseLiveOverlayQaMode("preflight-only"), "preflight-only");
    assert.equal(parseLiveOverlayQaMode(" expect-refusal "), "expect-refusal");
    for (const value of [undefined, "", "interactive", "passed-visible"]) {
      assert.throws(() => parseLiveOverlayQaMode(value), {
        message:
          "GAMEHUB_QA_LIVE_OVERLAY_MODE must be preflight-only or expect-refusal.",
      });
    }
  });

  it("accepts unavailable only as a verified expected refusal", () => {
    assert.deepEqual(refusal({ gateReason: "unavailable" }), {
      accepted: true,
      reason: "live-input-policy-disabled",
    });
    assert.deepEqual(
      refusal({
        gateReason: "unavailable",
        liveInputKillSwitchConfirmed: false,
        accessBlocked: true,
      }),
      { accepted: false, reason: "unverified-unavailable-result" }
    );
    assert.deepEqual(
      refusal({
        mode: LIVE_OVERLAY_QA_MODE.preflightOnly,
        gateReason: "unavailable",
      }),
      { accepted: false, reason: "mode-does-not-expect-refusal" }
    );
  });

  it("rejects any visible interactive overlay in expect-refusal mode", () => {
    assert.deepEqual(
      refusal({ overlayVisible: true, gateReason: "unavailable" }),
      {
        accepted: false,
        reason: "interactive-overlay-became-visible",
      }
    );
  });

  it("retains the existing access, module, and unsupported refusals", () => {
    assert.equal(refusal({ accessBlocked: true }).accepted, true);
    assert.equal(refusal({ moduleBlocked: true }).accepted, true);
    assert.equal(refusal({ gateReason: "unsupported" }).accepted, true);
    assert.equal(refusal({ unsupportedModuleMask: 4 }).accepted, true);
    assert.deepEqual(refusal(), {
      accepted: false,
      reason: "no-explicit-safety-refusal",
    });
  });

  it("requires the exact synthetic-focus acknowledgement", () => {
    assert.equal(isSyntheticFocusExplicitlyAllowed(undefined), false);
    assert.equal(isSyntheticFocusExplicitlyAllowed("true"), false);
    assert.equal(
      isSyntheticFocusExplicitlyAllowed(SYNTHETIC_FOCUS_ACKNOWLEDGEMENT),
      true
    );
  });
});
