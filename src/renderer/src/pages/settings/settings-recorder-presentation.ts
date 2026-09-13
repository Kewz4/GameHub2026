import type { GameRecorderState } from "@types";

export type SettingsRecorderBackendPresentation =
  | "native_active_verified"
  | "native_historical"
  | "compatibility_active_verified"
  | "compatibility_historical"
  | "native_active_pending"
  | "x11_active_verified"
  | "x11_historical"
  | "x11_active_pending"
  | "compatibility_active_pending"
  | "capture_unavailable"
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
    if (diagnosticBackend === "native_ffmpeg_x11") return "x11_historical";
    return diagnosticBackend === "native_ffmpeg_nvenc"
      ? "native_historical"
      : "compatibility_historical";
  }

  if (
    diagnosticBackend &&
    state?.captureActive &&
    state.activeCaptureBackend === diagnosticBackend
  ) {
    if (diagnosticBackend === "native_ffmpeg_x11") return "x11_active_verified";
    return diagnosticBackend === "native_ffmpeg_nvenc"
      ? "native_active_verified"
      : "compatibility_active_verified";
  }

  if (state?.captureActive && state.activeCaptureBackend) {
    if (state.activeCaptureBackend === "native_ffmpeg_x11")
      return "x11_active_pending";
    return state.activeCaptureBackend === "native_ffmpeg_nvenc"
      ? "native_active_pending"
      : "compatibility_active_pending";
  }

  if (state?.status === "unavailable") return "capture_unavailable";
  if (state?.nativeVideoEncodingAvailable === true) {
    return "native_machine_available";
  }
  if (state?.nativeVideoEncodingAvailable === false) {
    return "native_machine_unavailable";
  }
  return "capability_pending";
}
