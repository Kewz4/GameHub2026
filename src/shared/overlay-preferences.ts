import type { HydraOverlayPreferences } from "@types";

export const DEFAULT_HYDRA_OVERLAY_PREFERENCES: HydraOverlayPreferences = {
  overlayEnabled: true,
  overlayPerformanceEnabled: true,
  overlayPerformanceShowFps: true,
  overlayPerformanceShowAverageFps: true,
  overlayPerformanceShowFrameTime: true,
  overlayPerformanceShowOnePercentLow: true,
  overlayPauseGameWhileOpen: false,
};

export const resolveHydraOverlayPreferences = (
  preferences?: Partial<HydraOverlayPreferences> | null
): HydraOverlayPreferences => ({
  overlayEnabled: preferences?.overlayEnabled ?? true,
  overlayPerformanceEnabled: preferences?.overlayPerformanceEnabled ?? true,
  overlayPerformanceShowFps: preferences?.overlayPerformanceShowFps ?? true,
  overlayPerformanceShowAverageFps:
    preferences?.overlayPerformanceShowAverageFps ?? true,
  overlayPerformanceShowFrameTime:
    preferences?.overlayPerformanceShowFrameTime ?? true,
  overlayPerformanceShowOnePercentLow:
    preferences?.overlayPerformanceShowOnePercentLow ?? true,
  // Off by default: suspending the game is safe for single-player titles but
  // will disconnect anything online, so the user opts in.
  overlayPauseGameWhileOpen: preferences?.overlayPauseGameWhileOpen ?? false,
});
