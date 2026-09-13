import type { GameRecorderState } from "@types";

export interface GameRecorderStatusPresentation {
  title: string;
  detail: string;
  diagnostics: string | null;
  tone: "neutral" | "success" | "danger";
}

function getBackendLabel(
  backend: GameRecorderState["activeCaptureBackend"] | undefined
) {
  return backend === "native_ffmpeg_nvenc"
    ? "Native NVIDIA NVENC"
    : backend === "native_ffmpeg_x11"
      ? "Native X11 H.264"
      : backend === "media_recorder"
        ? "Compatibility capture"
        : null;
}

function getCapabilityDetail(state: GameRecorderState, platform: string) {
  if (platform === "linux") {
    return state.nativeVideoEncodingAvailable === true
      ? "Machine check: native X11 H.264 capture is available; the active game backend is verified after a completed segment."
      : state.nativeVideoEncodingAvailable === false
        ? "Machine check: native X11 H.264 capture is unavailable; compatibility capture is used only when a safe game-window source is available."
        : "Checking the Linux capture backend.";
  }
  if (state.nativeVideoEncodingAvailable === true) {
    return "Machine check: bundled FFmpeg can initialize NVIDIA NVENC; the active game backend is verified after a completed segment.";
  }

  if (state.nativeVideoEncodingAvailable === false) {
    return "Machine check: native NVIDIA NVENC is unavailable; GameHub will use compatibility capture.";
  }

  return "Checking bundled FFmpeg NVIDIA NVENC capability.";
}

const STATUS_TITLES: Record<GameRecorderState["status"], string> = {
  disabled: "Gameplay capture is off",
  waiting: "Waiting for a foreground game",
  ready: "Capture ready",
  buffering: "Instant Replay is buffering",
  recording: "Recording gameplay",
  saving: "Saving capture",
  unavailable: "Gameplay capture is unavailable",
  error: "Gameplay capture needs attention",
};

export function getGameRecorderStatusPresentation(
  state: GameRecorderState | null,
  platform = "win32"
): GameRecorderStatusPresentation {
  if (!state) {
    return {
      title: "Checking capture status",
      detail: "GameHub is connecting to the recorder service.",
      diagnostics: null,
      tone: "neutral",
    };
  }

  const fallbackDetail =
    state.status === "buffering"
      ? `${Math.floor(state.bufferedSeconds)} of ${state.configuration.replayDurationSeconds} seconds buffered`
      : state.status === "recording" && state.gameTitle
        ? `Recording ${state.gameTitle}`
        : state.status === "waiting"
          ? "Start a game and keep its window in the foreground."
          : "Recorder settings apply to the next capture session.";
  const diagnostics = state.captureDiagnostics;
  const diagnosticBackend = getBackendLabel(diagnostics?.backend);
  const diagnosticDetails = diagnostics
    ? [
        `${diagnostics.outputWidth}×${diagnostics.outputHeight}`,
        `${Math.round(diagnostics.outputFps)} FPS`,
        `${Math.round(diagnostics.targetVideoBitrate / 1_000_000)} Mbps target`,
        diagnostics.hasAudio ? "system audio" : "video only",
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const activeBackend = getBackendLabel(state.activeCaptureBackend);
  let diagnosticsText: string | null =
    state.status === "unavailable"
      ? null
      : getCapabilityDetail(state, platform);

  if (
    state.captureActive &&
    diagnostics?.backend === state.activeCaptureBackend
  ) {
    diagnosticsText = `Active verified · ${diagnosticBackend} · ${diagnosticDetails}`;
  } else if (state.captureActive && activeBackend) {
    diagnosticsText = diagnostics?.backend
      ? `Active ${activeBackend} · verification pending; last completed segment used ${diagnosticBackend}`
      : `Active ${activeBackend} · waiting for a completed segment to verify the backend`;
  } else if (!state.captureActive && diagnostics) {
    diagnosticsText = `Last completed segment · ${diagnosticBackend} · ${diagnosticDetails}`;
  }

  return {
    title: STATUS_TITLES[state.status],
    detail: state.errorMessage ?? state.statusMessage ?? fallbackDetail,
    diagnostics: diagnosticsText,
    tone:
      state.status === "error" || state.status === "unavailable"
        ? "danger"
        : state.status === "ready" ||
            state.status === "buffering" ||
            state.status === "recording"
          ? "success"
          : "neutral",
  };
}
