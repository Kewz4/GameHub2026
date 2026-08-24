export const LIVE_OVERLAY_QA_MODE = Object.freeze({
  preflightOnly: "preflight-only",
  expectRefusal: "expect-refusal",
});

export const SYNTHETIC_FOCUS_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_SYNTHESIZES_A_BALANCED_ALT_KEY";

const LIVE_OVERLAY_QA_MODES = new Set(Object.values(LIVE_OVERLAY_QA_MODE));

export function parseLiveOverlayQaMode(value) {
  const mode = String(value ?? "").trim();
  if (!LIVE_OVERLAY_QA_MODES.has(mode)) {
    throw new Error(
      "GAMEHUB_QA_LIVE_OVERLAY_MODE must be preflight-only or expect-refusal."
    );
  }
  return mode;
}

export function isSyntheticFocusExplicitlyAllowed(value) {
  return String(value ?? "").trim() === SYNTHETIC_FOCUS_ACKNOWLEDGEMENT;
}

/**
 * Classify only a non-visible result from the guarded external-window runner.
 * A policy-level `unavailable` result is accepted solely when the selected
 * mode expects refusal and the current built main process was independently
 * confirmed to contain the disabled live-input switch.
 */
export function evaluateExpectedOverlayRefusal({
  mode,
  overlayVisible,
  gateReason,
  accessBlocked,
  moduleBlocked,
  unsupportedModuleMask,
  liveInputKillSwitchConfirmed,
}) {
  if (mode !== LIVE_OVERLAY_QA_MODE.expectRefusal) {
    return { accepted: false, reason: "mode-does-not-expect-refusal" };
  }
  if (overlayVisible) {
    return { accepted: false, reason: "interactive-overlay-became-visible" };
  }
  if (gateReason === "unavailable") {
    return liveInputKillSwitchConfirmed
      ? { accepted: true, reason: "live-input-policy-disabled" }
      : { accepted: false, reason: "unverified-unavailable-result" };
  }
  if (gateReason === "unsupported" || unsupportedModuleMask !== 0) {
    return { accepted: true, reason: "unsupported-input-stack" };
  }
  if (accessBlocked) {
    return { accepted: true, reason: "process-access-refused" };
  }
  if (moduleBlocked) {
    return { accepted: true, reason: "module-risk-refused" };
  }
  return { accepted: false, reason: "no-explicit-safety-refusal" };
}
