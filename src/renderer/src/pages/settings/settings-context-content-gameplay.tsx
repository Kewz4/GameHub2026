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
import { QuestionIcon } from "@primer/octicons-react";
import type {
  GameRecorderFps,
  GameRecorderReplayDuration,
  GameRecorderResolution,
} from "@types";

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
    enableNewDownloadOptionsBadges: true,
    overlayEnabled: true,
    overlayPerformanceEnabled: true,
    gameRecorderEnabled: false,
    gameRecorderResolution: "1080p" as GameRecorderResolution,
    gameRecorderFps: 60 as GameRecorderFps,
    gameRecorderInstantReplayEnabled: false,
    gameRecorderReplayDurationSeconds: 30 as GameRecorderReplayDuration,
    gameRecorderCaptureAudio: true,
    gameRecorderOutputDirectory: null as string | null,
  });

  const [resolvedRecorderOutputDirectory, setResolvedRecorderOutputDirectory] =
    useState("");
  const spotifySystemAudioBlocked =
    userPreferences?.musicProvider === "spotify";

  useEffect(() => {
    window.electron
      .gameRecorderGetPreferences()
      .then((state) =>
        setResolvedRecorderOutputDirectory(state.resolvedOutputDirectory)
      )
      .catch(() => undefined);
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
      enableNewDownloadOptionsBadges:
        userPreferences.enableNewDownloadOptionsBadges ?? true,
      overlayEnabled: userPreferences.overlayEnabled ?? true,
      overlayPerformanceEnabled:
        userPreferences.overlayPerformanceEnabled ?? true,
      gameRecorderEnabled: userPreferences.gameRecorderEnabled ?? false,
      gameRecorderResolution: userPreferences.gameRecorderResolution ?? "1080p",
      gameRecorderFps: userPreferences.gameRecorderFps ?? 60,
      gameRecorderInstantReplayEnabled:
        userPreferences.gameRecorderInstantReplayEnabled ?? false,
      gameRecorderReplayDurationSeconds:
        userPreferences.gameRecorderReplayDurationSeconds ?? 30,
      gameRecorderCaptureAudio:
        userPreferences.gameRecorderCaptureAudio ?? true,
      gameRecorderOutputDirectory:
        userPreferences.gameRecorderOutputDirectory ?? null,
    });
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

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
          label={t("autoplay_trailers_on_game_page")}
          checked={form.autoplayGameTrailers}
          onChange={() =>
            handleChange({
              autoplayGameTrailers: !form.autoplayGameTrailers,
            })
          }
        />

        <CheckboxField
          label={t("disable_nsfw_alert")}
          checked={form.disableNsfwAlert}
          onChange={() =>
            handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
          }
        />

        <CheckboxField
          label={t("hide_mature_games")}
          checked={form.hideMatureGames}
          onChange={() =>
            handleChange({ hideMatureGames: !form.hideMatureGames })
          }
        />

        <CheckboxField
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

        <div className={`settings-behavior__checkbox-container--with-tooltip`}>
          <CheckboxField
            label={t("enable_steam_achievements")}
            checked={form.enableSteamAchievements}
            onChange={() =>
              handleChange({
                enableSteamAchievements: !form.enableSteamAchievements,
              })
            }
          />

          <small
            className="settings-behavior__checkbox-container--tooltip"
            data-open-article="steam-achievements"
          >
            <QuestionIcon size={12} />
          </small>
        </div>

        <CheckboxField
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
          label={t("enable_in_game_overlay")}
          checked={form.overlayEnabled}
          onChange={() =>
            handleChange({ overlayEnabled: !form.overlayEnabled })
          }
        />

        <CheckboxField
          label={t("overlay_performance_hud")}
          checked={form.overlayPerformanceEnabled}
          onChange={() =>
            handleChange({
              overlayPerformanceEnabled: !form.overlayPerformanceEnabled,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("gameplay_capture")}</h3>

        <p className="settings-context-panel__description">
          {t("gameplay_capture_description")}
        </p>

        <CheckboxField
          label={t("enable_gameplay_capture")}
          checked={form.gameRecorderEnabled}
          onChange={() =>
            handleChange({
              gameRecorderEnabled: !form.gameRecorderEnabled,
            })
          }
        />

        <CheckboxField
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
        {spotifySystemAudioBlocked && (
          <HelperText tone="danger">
            System audio is disabled while Spotify Connect is selected. This
            keeps Spotify music out of gameplay recordings and Instant Replay;
            switch back to GameHub Music to restore your saved game-audio
            preference.
          </HelperText>
        )}

        <TextField
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
