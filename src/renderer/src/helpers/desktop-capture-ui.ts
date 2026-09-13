import type { GameRecorderState } from "@types";

/** Capability comes from the running backend, not from a saved enable switch.
 * Older Windows backends keep their established behavior; Linux must positively
 * identify a safe capture source before controls become actionable. */
export function getDesktopCaptureUiCapabilities(
  state: GameRecorderState | null,
  platform: string
) {
  return {
    checking: state === null,
    screenshots: state?.desktopCaptureAvailable ?? platform !== "linux",
    systemAudio: state?.systemAudioCaptureAvailable ?? platform === "win32",
  };
}
