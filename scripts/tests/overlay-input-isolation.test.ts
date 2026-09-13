import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAdvertiseOverlayInputIsolation,
  getOverlayInputIsolationMode,
} from "../../src/main/services/overlay-input-isolation.ts";
import {
  OVERLAY_INPUT_REQUIRED_CAPABILITIES,
  type OverlayInputGateReadiness,
} from "../../src/main/services/overlay-input-gate.ts";

const ready = (pid: number): OverlayInputGateReadiness => ({
  ready: true,
  status: {
    ready: true,
    ownerPid: 100,
    targetPid: pid,
    blocked: false,
    generation: 2,
    readyPid: pid,
    readyGeneration: 2,
    capabilityMask: OVERLAY_INPUT_REQUIRED_CAPABILITIES,
    unsupportedModuleMask: 0,
    hookStatus: 301,
  },
});

const failed = (
  reason: "unsupported" | "unavailable" | "timeout" | "target-changed"
): OverlayInputGateReadiness => ({
  ready: false,
  reason,
  status:
    reason === "target-changed"
      ? null
      : {
          ready: false,
          ownerPid: 100,
          targetPid: 55,
          blocked: false,
          generation: 2,
          readyPid: 0,
          readyGeneration: 0,
          capabilityMask: 0,
          unsupportedModuleMask: reason === "unsupported" ? 2 : 0,
          hookStatus: reason === "unavailable" ? 5 : 0,
        },
});

describe("overlay input isolation policy", () => {
  it("advertises and opens only after the injected gate positively acknowledges", () => {
    assert.equal(canAdvertiseOverlayInputIsolation(ready(55)), true);
    assert.equal(getOverlayInputIsolationMode(ready(55), true), "hook");
    assert.equal(getOverlayInputIsolationMode(ready(55), false), "none");
  });

  for (const reason of [
    "unsupported",
    "unavailable",
    "timeout",
    "target-changed",
  ] as const) {
    it(`keeps ${reason} titles closed instead of suspending their process`, () => {
      assert.equal(canAdvertiseOverlayInputIsolation(failed(reason)), false);
      assert.equal(getOverlayInputIsolationMode(failed(reason), true), "none");
    });
  }
});
