export type OverlayWindowModeFailureReason =
  | "exclusive-fullscreen"
  | "window-compositor-unavailable";

export type OverlayWindowModeEligibility =
  | { allowed: true; mode: "windowed-or-borderless" }
  | { allowed: false; reason: OverlayWindowModeFailureReason };

export interface OverlayWindowModeEvidence {
  platform: NodeJS.Platform;
  targetWindowId: string | null;
  exactWindowSourceAvailable: boolean;
  displaySized: boolean;
}

/**
 * Interactive overlays are ordinary compositor windows. On Windows and Linux
 * X11, authorize one only when Electron enumerates the exact target window as
 * a capture source. A display-sized HWND without that compositor evidence is
 * treated as exclusive fullscreen and refused; a smaller missing source is a
 * generic compositor failure. No process memory, DLL injection, or graphics
 * API hook participates in this decision.
 */
export const evaluateOverlayWindowMode = ({
  platform,
  targetWindowId,
  exactWindowSourceAvailable,
  displaySized,
}: OverlayWindowModeEvidence): OverlayWindowModeEligibility => {
  if (platform !== "win32" && platform !== "linux") {
    return { allowed: true, mode: "windowed-or-borderless" };
  }

  if (targetWindowId && exactWindowSourceAvailable) {
    return { allowed: true, mode: "windowed-or-borderless" };
  }

  return {
    allowed: false,
    reason: platform === "win32" && displaySized
      ? "exclusive-fullscreen"
      : "window-compositor-unavailable",
  };
};

export const isExactDesktopWindowSource = (
  sourceId: string,
  targetWindowId: string
) => {
  const [kind, windowId] = sourceId.split(":");
  return kind === "window" && windowId === targetWindowId;
};
