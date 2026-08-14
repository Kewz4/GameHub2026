import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  HelperText,
  SelectField,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type {
  GameRecorderFps,
  GameRecorderQualityPreset,
  GameRecorderReplayDuration,
  GameRecorderResolution,
  GameRecorderState,
} from "@types";
import {
  DEFAULT_GAME_RECORDER_PREFERENCES,
  DEFAULT_HYDRA_OVERLAY_PREFERENCES,
  getGameRecorderEstimatedBufferBytes,
  getGameRecorderVideoBitrate,
} from "@shared";
import { getSettingsRecorderBackendPresentation } from "./settings-recorder-presentation";

import "./settings-behavior.scss";

export function SettingsContextContentGameplay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    autoplayGameTrailers: true,
    disableNsfwAlert: false,
    hideMatureGames: false,
    showHiddenAchievementsDescription: false,
    enableSteamAchievements: false,
    enableAchievementSouvenirs: false,
    enableNewDownloadOptionsBadges: true,
    ...DEFAULT_HYDRA_OVERLAY_PREFERENCES,
    gameRecorderEnabled: DEFAULT_GAME_RECORDER_PREFERENCES.enabled,
    gameRecorderResolution: DEFAULT_GAME_RECORDER_PREFERENCES.resolution,
    gameRecorderFps: DEFAULT_GAME_RECORDER_PREFERENCES.fps,
    gameRecorderQualityPreset: DEFAULT_GAME_RECORDER_PREFERENCES.qualityPreset,
    gameRecorderInstantReplayEnabled:
      DEFAULT_GAME_RECORDER_PREFERENCES.instantReplayEnabled,
    gameRecorderReplayDurationSeconds:
      DEFAULT_GAME_RECORDER_PREFERENCES.replayDurationSeconds,
    gameRecorderCaptureAudio:
      DEFAULT_GAME_RECORDER_PREFERENCES.captureGameAudio,
    gameRecorderOutputDirectory: null as string | null,
  });

  const [resolvedRecorderOutputDirectory, setResolvedRecorderOutputDirectory] =
    useState("");
  const [recorderState, setRecorderState] = useState<GameRecorderState | null>(
    null
  );
  const spotifySystemAudioBlocked =
    userPreferences?.musicProvider === "spotify";

  useEffect(() => {
    let active = true;
    const applyRecorderState = (state: GameRecorderState) => {
      if (!active) return;
      setResolvedRecorderOutputDirectory(state.resolvedOutputDirectory);
      setRecorderState(state);
    };

    window.electron
      .gameRecorderGetPreferences()
      .then(applyRecorderState)
      .catch(() => undefined);

    const unsubscribe = window.electron.onGameRecorderState(applyRecorderState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
      disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
      hideMatureGames: userPreferences.hideMatureGames ?? false,
      showHiddenAchievementsDescription:
        userPreferences.showHiddenAchievementsDescription ?? false,
      enableSteamAchievements: userPreferences.enableSteamAchievements ?? false,
      enableAchievementSouvenirs:
        userPreferences.enableAchievementSouvenirs ?? false,
      enableNewDownloadOptionsBadges:
        userPreferences.enableNewDownloadOptionsBadges ?? true,
      overlayEnabled:
        userPreferences.overlayEnabled ??
        DEFAULT_HYDRA_OVERLAY_PREFERENCES.overlayEnabled,
      overlayPerformanceEnabled:
        userPreferences.overlayPerformanceEnabled ??
        DEFAULT_HYDRA_OVERLAY_PREFERENCES.overlayPerformanceEnabled,
      overlayPerformanceShowFps:
        userPreferences.overlayPerformanceShowFps ??
        DEFAULT_HYDRA_OVERLAY_PREFERENCES.overlayPerformanceShowFps,
      overlayPerformanceShowAverageFps:
        userPreferences.overlayPerformanceShowAverageFps ??
        DEFAULT_HYDRA_OVERLAY_PREFERENCES.overlayPerformanceShowAverageFps,
      overlayPerformanceShowFrameTime:
        userPreferences.overlayPerformanceShowFrameTime ??
        DEFAULT_HYDRA_OVERLAY_PREFERENCES.overlayPerformanceShowFrameTime,
      overlayPerformanceShowOnePercentLow:
        userPreferences.overlayPerformanceShowOnePercentLow ??
        DEFAULT_HYDRA_OVERLAY_PREFERENCES.overlayPerformanceShowOnePercentLow,
      gameRecorderEnabled:
        userPreferences.gameRecorderEnabled ??
        DEFAULT_GAME_RECORDER_PREFERENCES.enabled,
      gameRecorderResolution:
        userPreferences.gameRecorderResolution ??
        DEFAULT_GAME_RECORDER_PREFERENCES.resolution,
      gameRecorderFps:
        userPreferences.gameRecorderFps ??
        DEFAULT_GAME_RECORDER_PREFERENCES.fps,
      gameRecorderQualityPreset:
        userPreferences.gameRecorderQualityPreset ??
        DEFAULT_GAME_RECORDER_PREFERENCES.qualityPreset,
      gameRecorderInstantReplayEnabled:
        userPreferences.gameRecorderInstantReplayEnabled ??
        DEFAULT_GAME_RECORDER_PREFERENCES.instantReplayEnabled,
      gameRecorderReplayDurationSeconds:
        userPreferences.gameRecorderReplayDurationSeconds ??
        DEFAULT_GAME_RECORDER_PREFERENCES.replayDurationSeconds,
      gameRecorderCaptureAudio:
        userPreferences.gameRecorderCaptureAudio ??
        DEFAULT_GAME_RECORDER_PREFERENCES.captureGameAudio,
      gameRecorderOutputDirectory:
        userPreferences.gameRecorderOutputDirectory ?? null,
    });
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const recorderConfiguration = {
    resolution: form.gameRecorderResolution,
    fps: form.gameRecorderFps,
    qualityPreset: form.gameRecorderQualityPreset,
    captureGameAudio: form.gameRecorderCaptureAudio,
    replayDurationSeconds: form.gameRecorderReplayDurationSeconds,
  };
  const recorderTargetBitrateMbps = Math.round(
    getGameRecorderVideoBitrate(
      recorderConfiguration,
      null,
      "video/mp4;codecs=avc1"
    ) / 1_000_000
  );
  const recorderBufferMegabytes = Math.round(
    getGameRecorderEstimatedBufferBytes(recorderConfiguration) / 1_000_000
  );
  const recorderBackendPresentation =
    getSettingsRecorderBackendPresentation(recorderState);

  const chooseRecorderOutputDirectory = async () => {
    const result = await window.electron.showOpenDialog({
      defaultPath:
        form.gameRecorderOutputDirectory ??
        resolvedRecorderOutputDirectory ??
        undefined,
      properties: ["openDirectory"],
    });
    const selected = result.filePaths?.[0];
    if (!selected) return;
    setResolvedRecorderOutputDirectory(selected);
    handleChange({ gameRecorderOutputDirectory: selected });
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("content_preferences")}</h3>

        <CheckboxField
          id="settings-autoplay-trailers"
          label={t("autoplay_trailers_on_game_page")}
          checked={form.autoplayGameTrailers}
          onChange={() =>
            handleChange({
              autoplayGameTrailers: !form.autoplayGameTrailers,
            })
          }
        />

        <CheckboxField
          id="settings-disable-nsfw-alert"
          label={t("disable_nsfw_alert")}
          checked={form.disableNsfwAlert}
          onChange={() =>
            handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
          }
        />

        <CheckboxField
          id="settings-hide-mature-games"
          label={t("hide_mature_games")}
          checked={form.hideMatureGames}
          onChange={() =>
            handleChange({ hideMatureGames: !form.hideMatureGames })
          }
        />

        <CheckboxField
          id="settings-show-hidden-achievements"
          label={t("show_hidden_achievement_description")}
          checked={form.showHiddenAchievementsDescription}
          onChange={() =>
            handleChange({
              showHiddenAchievementsDescription:
                !form.showHiddenAchievementsDescription,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("gameplay_metadata")}</h3>

        <CheckboxField
          id="settings-enable-steam-achievements"
          label={t("enable_steam_achievements")}
          checked={form.enableSteamAchievements}
          onChange={() =>
            handleChange({
              enableSteamAchievements: !form.enableSteamAchievements,
            })
          }
        />

        <CheckboxField
          id="settings-enable-achievement-souvenirs"
          label={t("enable_achievement_souvenirs", {
            defaultValue: "Capture achievement souvenirs",
          })}
          checked={form.enableAchievementSouvenirs}
          disabled={window.electron.platform === "linux"}
          onChange={() =>
            handleChange({
              enableAchievementSouvenirs: !form.enableAchievementSouvenirs,
            })
          }
        />
        <HelperText>
          {window.electron.platform === "linux"
            ? t("achievement_souvenirs_linux_unavailable", {
                defaultValue:
                  "Souvenir capture is paused on Linux until portal-safe capture is available.",
              })
            : t("achievement_souvenirs_description", {
                defaultValue:
                  "Captures the foreground game before the achievement toast, keeps a local copy, and mirrors it to your private GameHub R2 storage. No subscription is required.",
              })}
        </HelperText>
        <Button
          type="button"
          theme="outline"
          onClick={() => window.electron.openAchievementSouvenirsFolder()}
        >
          {t("open_achievement_souvenirs_folder", {
            defaultValue: "Open souvenir folder",
          })}
        </Button>

        <CheckboxField
          id="settings-new-download-option-badges"
          label={t("enable_new_download_options_badges")}
          checked={form.enableNewDownloadOptionsBadges}
          onChange={() =>
            handleChange({
              enableNewDownloadOptionsBadges:
                !form.enableNewDownloadOptionsBadges,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("in_game_overlay")}</h3>

        <CheckboxField
          id="settings-overlay-enabled"
          label={t("enable_in_game_overlay")}
          checked={form.overlayEnabled}
          onChange={() =>
            handleChange({ overlayEnabled: !form.overlayEnabled })
          }
        />

        <CheckboxField
          id="settings-overlay-performance-enabled"
          label={t("overlay_performance_hud")}
          checked={form.overlayPerformanceEnabled}
          disabled={!form.overlayEnabled}
          onChange={() =>
            handleChange({
              overlayPerformanceEnabled: !form.overlayPerformanceEnabled,
            })
          }
        />

        <div className="settings-context-panel__nested-group">
          <CheckboxField
            id="settings-overlay-show-fps"
            label={t("overlay_show_fps", { defaultValue: "Show current FPS" })}
            checked={form.overlayPerformanceShowFps}
            disabled={!form.overlayEnabled || !form.overlayPerformanceEnabled}
            onChange={() =>
              handleChange({
                overlayPerformanceShowFps: !form.overlayPerformanceShowFps,
              })
            }
          />

          <CheckboxField
            id="settings-overlay-show-average-fps"
            label={t("overlay_show_average_fps", {
              defaultValue: "Show average FPS",
            })}
            checked={form.overlayPerformanceShowAverageFps}
            disabled={!form.overlayEnabled || !form.overlayPerformanceEnabled}
            onChange={() =>
              handleChange({
                overlayPerformanceShowAverageFps:
                  !form.overlayPerformanceShowAverageFps,
              })
            }
          />

          <CheckboxField
            id="settings-overlay-show-frame-time"
            label={t("overlay_show_frame_time", {
              defaultValue: "Show frame time",
            })}
            checked={form.overlayPerformanceShowFrameTime}
            disabled={!form.overlayEnabled || !form.overlayPerformanceEnabled}
            onChange={() =>
              handleChange({
                overlayPerformanceShowFrameTime:
                  !form.overlayPerformanceShowFrameTime,
              })
            }
          />

          <CheckboxField
            id="settings-overlay-show-one-percent-low"
            label={t("overlay_show_one_percent_low", {
              defaultValue: "Show 1% low FPS",
            })}
            checked={form.overlayPerformanceShowOnePercentLow}
            disabled={!form.overlayEnabled || !form.overlayPerformanceEnabled}
            onChange={() =>
              handleChange({
                overlayPerformanceShowOnePercentLow:
                  !form.overlayPerformanceShowOnePercentLow,
              })
            }
          />
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("gameplay_capture")}</h3>

        <p className="settings-context-panel__description">
          {t("gameplay_capture_runtime_description", {
            defaultValue:
              "GameHub prefers exact-window native capture on supported Windows and NVIDIA setups, then falls back to compatibility game capture. Capture and Instant Replay pause whenever the detected game is no longer in the foreground.",
          })}
        </p>

        <CheckboxField
          id="settings-game-recorder-enabled"
          label={t("enable_gameplay_capture")}
          checked={form.gameRecorderEnabled}
          onChange={() =>
            handleChange({
              gameRecorderEnabled: !form.gameRecorderEnabled,
            })
          }
        />

        <CheckboxField
          id="settings-game-recorder-instant-replay-enabled"
          label={t("enable_instant_replay")}
          checked={form.gameRecorderInstantReplayEnabled}
          disabled={!form.gameRecorderEnabled}
          onChange={() =>
            handleChange({
              gameRecorderInstantReplayEnabled:
                !form.gameRecorderInstantReplayEnabled,
            })
          }
        />

        <SelectField
          id="settings-game-recorder-resolution"
          label={t("recording_resolution")}
          value={form.gameRecorderResolution}
          disabled={!form.gameRecorderEnabled}
          onChange={(event) =>
            handleChange({
              gameRecorderResolution: event.target
                .value as GameRecorderResolution,
            })
          }
          options={[
            { key: "source", value: "source", label: t("source_resolution") },
            { key: "720p", value: "720p", label: "720p" },
            { key: "1080p", value: "1080p", label: "1080p" },
            { key: "1440p", value: "1440p", label: "1440p" },
            { key: "2160p", value: "2160p", label: "2160p (4K)" },
          ]}
        />

        <SelectField
          id="settings-game-recorder-fps"
          label={t("recording_frame_rate")}
          value={String(form.gameRecorderFps)}
          disabled={!form.gameRecorderEnabled}
          onChange={(event) =>
            handleChange({
              gameRecorderFps: Number(event.target.value) as GameRecorderFps,
            })
          }
          options={[
            { key: "30", value: "30", label: "30 FPS" },
            { key: "60", value: "60", label: "60 FPS" },
            { key: "120", value: "120", label: "120 FPS" },
          ]}
        />

        <SelectField
          id="settings-game-recorder-quality"
          label={t("recording_quality_preset")}
          value={form.gameRecorderQualityPreset}
          disabled={!form.gameRecorderEnabled}
          onChange={(event) =>
            handleChange({
              gameRecorderQualityPreset: event.target
                .value as GameRecorderQualityPreset,
            })
          }
          options={[
            {
              key: "performance",
              value: "performance",
              label: t("recording_quality_performance"),
            },
            {
              key: "balanced",
              value: "balanced",
              label: t("recording_quality_balanced"),
            },
            {
              key: "quality",
              value: "quality",
              label: t("recording_quality_high"),
            },
          ]}
        />
        <HelperText>
          {t("recording_quality_storage_hint", {
            bitrate: recorderTargetBitrateMbps,
            size: recorderBufferMegabytes,
          })}
        </HelperText>
        {recorderBackendPresentation === "native_active_verified" ? (
          <HelperText>
            {t("native_recorder_verified", {
              defaultValue:
                "Active capture verified by a completed segment: native Windows Graphics Capture with NVIDIA NVENC.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "native_historical" ? (
          <HelperText>
            {t("native_recorder_last_segment", {
              defaultValue:
                "Last completed segment used native Windows Graphics Capture with NVIDIA NVENC. Capture is currently paused or inactive.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "compatibility_active_verified" ? (
          <HelperText>
            {t("compatibility_recorder_verified", {
              defaultValue:
                "Active capture verified by a completed segment: compatibility capture. Native NVIDIA NVENC was not selected for this game window.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "compatibility_historical" ? (
          <HelperText>
            {t("compatibility_recorder_last_segment", {
              defaultValue:
                "Last completed segment used compatibility capture. Capture is currently paused or inactive.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "native_active_pending" ? (
          <HelperText>
            {t("native_recorder_active_pending", {
              defaultValue:
                "Active capture selected native Windows Graphics Capture with NVIDIA NVENC. Waiting for a completed segment before verifying the backend.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "compatibility_active_pending" ? (
          <HelperText>
            {t("compatibility_recorder_active_pending", {
              defaultValue:
                "Compatibility capture is active. Waiting for a completed segment before confirming the backend from diagnostics.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "windows_unavailable" ? (
          <HelperText tone="danger">
            {t("recorder_windows_only", {
              defaultValue:
                "Gameplay capture is currently available on Windows.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "native_machine_available" ? (
          <HelperText>
            {t("native_recorder_machine_available", {
              defaultValue:
                "Machine check: GameHub's bundled FFmpeg can initialize NVIDIA NVENC. The backend used for a game is confirmed only after capture diagnostics are available.",
            })}
          </HelperText>
        ) : recorderBackendPresentation === "native_machine_unavailable" ? (
          <HelperText>
            {t("native_recorder_machine_unavailable", {
              defaultValue:
                "Machine check: native NVIDIA NVENC is unavailable. GameHub will use compatibility capture; the active backend is confirmed after a capture session.",
            })}
          </HelperText>
        ) : (
          <HelperText>
            {t("recorder_backend_pending", {
              defaultValue:
                "Checking the bundled FFmpeg NVIDIA NVENC capability. The active backend is confirmed only after a game window starts and capture diagnostics are available.",
            })}
          </HelperText>
        )}

        <SelectField
          id="settings-game-recorder-replay-duration"
          label={t("instant_replay_length")}
          value={String(form.gameRecorderReplayDurationSeconds)}
          disabled={
            !form.gameRecorderEnabled || !form.gameRecorderInstantReplayEnabled
          }
          onChange={(event) =>
            handleChange({
              gameRecorderReplayDurationSeconds: Number(
                event.target.value
              ) as GameRecorderReplayDuration,
            })
          }
          options={[15, 30, 45, 60].map((seconds) => ({
            key: String(seconds),
            value: String(seconds),
            label: t("seconds_short", { count: seconds }),
          }))}
        />

        <CheckboxField
          id="settings-game-recorder-capture-audio"
          label={t("capture_game_audio")}
          checked={
            spotifySystemAudioBlocked ? false : form.gameRecorderCaptureAudio
          }
          disabled={!form.gameRecorderEnabled || spotifySystemAudioBlocked}
          onChange={() =>
            handleChange({
              gameRecorderCaptureAudio: !form.gameRecorderCaptureAudio,
            })
          }
        />
        <HelperText>
          {t("capture_system_audio_scope", {
            defaultValue:
              "This records the Windows system mix—not only game audio—while the detected game is foreground. Audio capture pauses when you switch to another app.",
          })}
        </HelperText>
        {spotifySystemAudioBlocked && (
          <HelperText tone="danger">
            System audio is disabled while Spotify Connect is selected. This
            keeps Spotify music out of gameplay recordings and Instant Replay;
            switch back to GameHub Music to restore your saved game-audio
            preference.
          </HelperText>
        )}

        <TextField
          id="settings-game-recorder-output-directory"
          label={t("capture_output_directory")}
          value={
            form.gameRecorderOutputDirectory ?? resolvedRecorderOutputDirectory
          }
          readOnly
          rightContent={
            <Button
              type="button"
              theme="outline"
              onClick={chooseRecorderOutputDirectory}
            >
              {t("change")}
            </Button>
          }
        />

        <Button
          type="button"
          theme="outline"
          disabled={!form.gameRecorderEnabled}
          onClick={() => window.electron.gameRecorderOpenOutputDirectory()}
        >
          {t("open_capture_folder")}
        </Button>
      </div>
    </div>
  );
}
