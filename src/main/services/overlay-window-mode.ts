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
 * Interactive overlays are ordinary compositor windows. On Windows we only
 * authorize one when Electron can enumerate the exact target HWND as a window
 * capture source. A display-sized HWND without that compositor evidence is
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
  if (platform !== "win32") {
    return { allowed: true, mode: "windowed-or-borderless" };
  }

  if (targetWindowId && exactWindowSourceAvailable) {
    return { allowed: true, mode: "windowed-or-borderless" };
  }

  return {
    allowed: false,
    reason: displaySized
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
