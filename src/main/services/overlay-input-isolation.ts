import type { OverlayInputGateReadiness } from "./overlay-input-gate";

/**
 * A ready toast is a promise that the overlay can take input without leaking
 * it to the game. Only the positively acknowledged injected gate satisfies
 * that promise. Process suspension is intentionally not a fallback: if its
 * elevated watchdog were terminated, Windows would retain the suspend count
 * and could strand the game. Unsupported/access-denied titles therefore stay
 * closed while the safer hook path remains available to compatible games.
 */
export const canAdvertiseOverlayInputIsolation = (
  readiness: OverlayInputGateReadiness
) => readiness.ready;

export const getOverlayInputIsolationMode = (
  readiness: OverlayInputGateReadiness,
  activated: boolean
): "hook" | "none" => (readiness.ready && activated ? "hook" : "none");
