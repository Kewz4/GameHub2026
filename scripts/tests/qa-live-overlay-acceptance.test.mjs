import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boundsMatch,
  creationTimesMatch,
  diagnosticsMatchTargetIdentity,
  findOverlayUnavailableToast,
  findReadyToast,
  hasRequiredToastEvidence,
  isBoundRenderTargetState,
  requiredToastEvidenceForMode,
  sameProcessIdentity,
  validateRightEdgeToastGeometry,
  validateToastPresentationEvidence,
} from "../qa-live-overlay-acceptance.mjs";
import { LIVE_OVERLAY_QA_MODE } from "../qa-live-overlay-policy.mjs";

const renderPath = "C:\\Games\\Fixture\\fixture-game.exe";
const targetIdentity = Object.freeze({
  pid: 4242,
  creationDate: "133725123456789012",
  name: "fixture-game.exe",
  executablePath: renderPath,
});
const targetSpec = Object.freeze({
  executablePath: renderPath,
  trackingExecutablePaths: [],
  processNames: ["fixture-game.exe"],
  renderProcessName: "fixture-game.exe",
  processRoot: "C:\\Games\\Fixture",
});

const boundState = (overrides = {}) => ({
  diagnostics: {
    targetPid: targetIdentity.pid,
    targetCreationTimeTicks: targetIdentity.creationDate,
    targetExecutable: targetIdentity.executablePath,
    foregroundPid: targetIdentity.pid,
    targetBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windows: [],
    ...overrides.diagnostics,
  },
  processItem: { ...targetIdentity, ...overrides.processItem },
});

describe("live overlay acceptance evidence", () => {
  it("binds both diagnostics and process inventory to PID, creation, and exact render path", () => {
    assert.equal(
      creationTimesMatch("133725123456789012", "133725123456789016"),
      true
    );
    assert.equal(
      creationTimesMatch("133725123456789012", "133725123456809012"),
      false
    );
    assert.equal(sameProcessIdentity(targetIdentity, targetIdentity), true);
    assert.equal(
      sameProcessIdentity(targetIdentity, {
        ...targetIdentity,
        executablePath: undefined,
      }),
      false
    );
    assert.equal(
      diagnosticsMatchTargetIdentity(boundState().diagnostics, targetIdentity),
      true
    );
    assert.equal(
      isBoundRenderTargetState(boundState(), targetSpec, targetIdentity, {
        requireForeground: true,
        requireBounds: true,
      }),
      true
    );

    for (const changed of [
      boundState({ processItem: { creationDate: "133725123456809012" } }),
      boundState({
        processItem: {
          executablePath: "C:\\Games\\Fixture\\replacement.exe",
        },
      }),
      boundState({ diagnostics: { targetCreationTimeTicks: "1" } }),
      boundState({
        diagnostics: {
          targetExecutable: "C:\\Games\\Fixture\\replacement.exe",
        },
      }),
    ]) {
      assert.equal(
        isBoundRenderTargetState(changed, targetSpec, targetIdentity, {
          requireForeground: true,
          requireBounds: true,
        }),
        false
      );
    }
  });

  it("never treats a completed toggle as ready-toast evidence", () => {
    const noToast = { overlayTogglePending: false, windows: [] };
    assert.equal(findReadyToast(noToast), undefined);
    assert.equal(hasRequiredToastEvidence(noToast, "ready"), false);

    const hiddenReady = {
      overlayTogglePending: false,
      windows: [
        {
          url: "file:///renderer/index.html#/overlay-toast",
          visible: false,
        },
      ],
    };
    assert.equal(hasRequiredToastEvidence(hiddenReady, "ready"), false);

    const visibleReady = {
      overlayTogglePending: true,
      windows: [
        {
          url: "file:///renderer/index.html#/overlay-toast",
          visible: true,
        },
      ],
    };
    assert.equal(findReadyToast(visibleReady)?.visible, true);
    assert.equal(hasRequiredToastEvidence(visibleReady, "ready"), true);
    assert.equal(
      hasRequiredToastEvidence(
        {
          windows: [
            {
              url: "file:///renderer/index.html#/overlay-toast?reason=unsupported",
              visible: true,
            },
          ],
        },
        "ready"
      ),
      false
    );
  });

  it("requires the exact visible toast kind selected by the QA mode", () => {
    assert.equal(
      requiredToastEvidenceForMode(LIVE_OVERLAY_QA_MODE.preflightOnly),
      null
    );
    assert.equal(
      requiredToastEvidenceForMode(LIVE_OVERLAY_QA_MODE.launchOnly),
      null
    );
    assert.equal(
      requiredToastEvidenceForMode(LIVE_OVERLAY_QA_MODE.expectRefusal),
      "refusal"
    );
    assert.throws(() => requiredToastEvidenceForMode("interactive"));

    const refusal = {
      windows: [
        {
          url: "file:///renderer/index.html#/overlay-toast?kind=overlay-unavailable&reason=exclusive-fullscreen",
          visible: true,
        },
      ],
    };
    assert.equal(findOverlayUnavailableToast(refusal)?.visible, true);
    assert.equal(hasRequiredToastEvidence(refusal, "refusal"), true);
    assert.equal(hasRequiredToastEvidence(refusal, "ready"), false);

    for (const invalid of [
      { windows: [] },
      {
        windows: [
          {
            url: "file:///renderer/index.html#/overlay-toast?kind=overlay-unavailable",
            visible: false,
          },
        ],
      },
      {
        windows: [
          {
            url: "file:///renderer/index.html#/overlay-toast-extra?kind=overlay-unavailable",
            visible: true,
          },
        ],
      },
      {
        windows: [
          {
            url: "file:///renderer/index.html#/other#/overlay-toast?kind=overlay-unavailable",
            visible: true,
          },
        ],
      },
    ]) {
      assert.equal(hasRequiredToastEvidence(invalid, "refusal"), false);
    }
  });

  it("requires right-edge contact and the kind-specific compact host height", () => {
    const targetBounds = { x: -1920, y: 40, width: 1920, height: 1080 };
    const refusalToast = {
      bounds: { x: -440, y: 64, width: 440, height: 80 },
    };
    const evidence = validateRightEdgeToastGeometry(
      refusalToast,
      targetBounds,
      "refusal"
    );
    assert.equal(evidence.attachedToRightEdge, true);
    assert.equal(evidence.rightEdgeDeltaDip, 0);
    assert.equal(evidence.maxHeightDip, 80);

    assert.throws(
      () =>
        validateRightEdgeToastGeometry(
          { bounds: { ...refusalToast.bounds, x: -460 } },
          targetBounds,
          "refusal"
        ),
      /not attached to the target's right edge/u
    );
    assert.throws(
      () =>
        validateRightEdgeToastGeometry(
          { bounds: { ...refusalToast.bounds, height: 81 } },
          targetBounds,
          "refusal"
        ),
      /oversized empty host area/u
    );
    assert.throws(
      () =>
        validateRightEdgeToastGeometry(
          { bounds: { ...refusalToast.bounds, height: 65 } },
          targetBounds,
          "ready"
        ),
      /oversized empty host area/u
    );
  });

  it("proves the right-origin animation and balanced bottom spacing", () => {
    const presentation = {
      animationName: "overlay-toast-enter-from-right",
      animationDuration: "0.28s",
      frameTransforms: ["translateX(100%)", "translateX(0px)"],
      transformOrigin: "440px 40px",
      transformOriginX: 440,
      transformOriginRightDelta: 0,
      borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px",
      hostHeight: 80,
      windowHeight: 80,
      hostClientHeight: 80,
      hostScrollHeight: 80,
      contentTopGap: 14,
      contentBottomGap: 14,
    };
    const evidence = validateToastPresentationEvidence(presentation);
    assert.equal(evidence.rightOriginAnimation, true);
    assert.equal(evidence.flushRightEdgeCorners, true);
    assert.equal(evidence.noBottomEmptySpace, true);
    assert.equal(evidence.maxContentBottomGapDip, 16);

    assert.throws(
      () =>
        validateToastPresentationEvidence({
          ...presentation,
          frameTransforms: ["translateX(0px)"],
        }),
      /right-to-left entry animation/u
    );
    assert.throws(
      () =>
        validateToastPresentationEvidence({
          ...presentation,
          animationDuration: "0s",
        }),
      /right-to-left entry animation/u
    );
    assert.throws(
      () =>
        validateToastPresentationEvidence({
          ...presentation,
          contentTopGap: 17,
          contentBottomGap: 17,
        }),
      /excess bottom space/u
    );
    assert.throws(
      () =>
        validateToastPresentationEvidence({
          ...presentation,
          contentTopGap: 12,
          contentBottomGap: 14,
        }),
      /excess bottom space/u
    );
  });

  it("detects target-bound movement during capture", () => {
    const initial = { x: 100, y: 50, width: 1280, height: 720 };
    assert.equal(boundsMatch(initial, { ...initial }), true);
    assert.equal(boundsMatch(initial, { ...initial, x: 102 }), true);
    assert.equal(boundsMatch(initial, { ...initial, x: 103 }), false);
  });
});
