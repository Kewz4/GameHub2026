export interface OverlayActivationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OverlayActivationToastKind = "ready" | "error";

export const OVERLAY_ACTIVATION_GRACE_MS = 700;

// The activation surface belongs to the game's right edge. Keeping that edge
// exact lets the renderer reveal itself from outside the game instead of
// presenting as a detached card floating over the playfield.
const TOAST_MAX_WIDTH = 440;
const READY_TOAST_HEIGHT = 64;
const READY_TOAST_NARROW_HEIGHT = 82;
const ERROR_TOAST_HEIGHT = 80;
const ERROR_TOAST_NARROW_HEIGHT = 96;
const TOAST_MARGIN = 24;

/**
 * Electron positions BrowserWindows in device-independent pixels. This helper
 * deliberately receives bounds in that coordinate space and keeps the toast
 * fully inside the game at both normal and narrow window sizes. Its x position
 * intentionally shares the target's right boundary; the 24 DIP clearance is
 * kept on the inner (left) side when the target is narrower than the card.
 */
export const calculateActivationToastBounds = (
  target: OverlayActivationBounds,
  kind: OverlayActivationToastKind = "ready"
): OverlayActivationBounds => {
  const leftClearance = Math.min(TOAST_MARGIN, Math.max(0, target.width - 1));
  const width = Math.max(
    1,
    Math.min(TOAST_MAX_WIDTH, target.width - leftClearance)
  );
  const desiredHeight =
    kind === "error"
      ? width < 360
        ? ERROR_TOAST_NARROW_HEIGHT
        : ERROR_TOAST_HEIGHT
      : width < 360
        ? READY_TOAST_NARROW_HEIGHT
        : READY_TOAST_HEIGHT;
  const verticalInset = Math.min(
    TOAST_MARGIN,
    Math.floor(Math.max(0, target.height - desiredHeight) / 2)
  );
  const height = Math.max(
    1,
    Math.min(desiredHeight, target.height - verticalInset * 2)
  );

  return {
    x: target.x + target.width - width,
    y: target.y + verticalInset,
    width,
    height,
  };
};

export interface OverlayForegroundState {
  targetPid: number;
  foregroundPid: number;
  appPid: number;
  overlayVisible: boolean;
  overlayFocused: boolean;
  activationGraceUntil: number;
  now: number;
}

/**
 * BrowserWindow focus bookkeeping can trail SetForegroundWindow by a frame.
 * During that hand-off Windows reports either no foreground process or the
 * Electron host process. Keep the surface alive briefly for only those
 * ambiguous states; a real Alt+Tab to any other application still hides it
 * immediately.
 */
export const isOverlayInteractionForeground = ({
  targetPid,
  foregroundPid,
  appPid,
  overlayVisible,
  overlayFocused,
  activationGraceUntil,
  now,
}: OverlayForegroundState) => {
  if (!targetPid) return false;
  if (foregroundPid === targetPid) return true;
  if (!overlayVisible) return false;
  if (overlayFocused) return true;

  return (
    now <= activationGraceUntil &&
    (foregroundPid === 0 || foregroundPid === appPid)
  );
};

export const canShowActivationToast = (
  pending: boolean,
  alreadyShown: boolean,
  rendererReady: boolean,
  inputIsolationEnabled = true
) => inputIsolationEnabled && pending && !alreadyShown && rendererReady;
