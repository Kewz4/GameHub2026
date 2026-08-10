import type { GameRecorderState } from "@types";

export type SettingsRecorderBackendPresentation =
  | "native_active_verified"
  | "native_historical"
  | "compatibility_active_verified"
  | "compatibility_historical"
  | "native_active_pending"
  | "compatibility_active_pending"
  | "windows_unavailable"
  | "native_machine_available"
  | "native_machine_unavailable"
  | "capability_pending";

/**
 * Separates a machine capability probe, the backend selected by the live
 * capture process, and diagnostics produced by a completed segment. A stale
 * segment must never make a fallback backend look verified.
 */
export function getSettingsRecorderBackendPresentation(
  state: GameRecorderState | null
): SettingsRecorderBackendPresentation {
  const diagnosticBackend = state?.captureDiagnostics?.backend;

  if (diagnosticBackend && !state?.captureActive) {
    return diagnosticBackend === "native_ffmpeg_nvenc"
      ? "native_historical"
      : "compatibility_historical";
  }

  if (
    diagnosticBackend &&
    state?.captureActive &&
    state.activeCaptureBackend === diagnosticBackend
  ) {
    return diagnosticBackend === "native_ffmpeg_nvenc"
      ? "native_active_verified"
      : "compatibility_active_verified";
  }

  if (state?.captureActive && state.activeCaptureBackend) {
    return state.activeCaptureBackend === "native_ffmpeg_nvenc"
      ? "native_active_pending"
      : "compatibility_active_pending";
  }

  if (state?.status === "unavailable") return "windows_unavailable";
  if (state?.nativeVideoEncodingAvailable === true) {
    return "native_machine_available";
  }
  if (state?.nativeVideoEncodingAvailable === false) {
    return "native_machine_unavailable";
  }
  return "capability_pending";
}
