export interface OverlayActivationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const OVERLAY_ACTIVATION_GRACE_MS = 700;

const TOAST_MAX_WIDTH = 820;
const TOAST_DEFAULT_HEIGHT = 118;
const TOAST_MEDIUM_HEIGHT = 148;
const TOAST_NARROW_HEIGHT = 184;
const TOAST_MARGIN = 24;

/**
 * Electron positions BrowserWindows in device-independent pixels. This helper
 * deliberately receives bounds in that coordinate space and keeps the toast
 * fully inside the game at both normal and narrow window sizes.
 */
export const calculateActivationToastBounds = (
  target: OverlayActivationBounds
): OverlayActivationBounds => {
  const horizontalInset = Math.min(
    TOAST_MARGIN,
    Math.floor(Math.max(0, target.width - 1) / 2)
  );
  const width = Math.max(
    1,
    Math.min(TOAST_MAX_WIDTH, target.width - horizontalInset * 2)
  );
  const desiredHeight =
    width < 440
      ? TOAST_NARROW_HEIGHT
      : width < 640
        ? TOAST_MEDIUM_HEIGHT
        : TOAST_DEFAULT_HEIGHT;
  const verticalInset = Math.min(
    TOAST_MARGIN,
    Math.floor(Math.max(0, target.height - desiredHeight) / 2)
  );
  const height = Math.max(
    1,
    Math.min(desiredHeight, target.height - verticalInset * 2)
  );

  return {
    x: target.x + target.width - horizontalInset - width,
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
  rendererReady: boolean
) => pending && !alreadyShown && rendererReady;
