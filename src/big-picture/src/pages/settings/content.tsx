import "./content.scss";

import type {
  GameRecorderFps,
  GameRecorderQualityPreset,
  GameRecorderReplayDuration,
  GameRecorderResolution,
  GameRecorderState,
} from "@types";
import {
  DEFAULT_GAME_RECORDER_PREFERENCES,
  getGameRecorderEstimatedBufferBytes,
  getGameRecorderVideoBitrate,
  resolveGameRecorderPreferences,
} from "@shared";
import { useEffect, useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  DropdownSelect,
  FileExplorerModal,
  VerticalFocusGroup,
} from "../../components";
import { useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import { getGameRecorderStatusPresentation } from "./content-capture";
import {
  CONTENT_CAPTURE_FOCUS_IDS,
  CONTENT_ITEM_FOCUS_IDS,
  CONTENT_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import { getDesktopCaptureUiCapabilities } from "@renderer/helpers/desktop-capture-ui";

interface SettingsSectionProps {
  className?: string;
}

interface ContentForm {
  autoplayGameTrailers: boolean;
  disableNsfwAlert: boolean;
  showHiddenAchievementsDescription: boolean;
  enableSteamAchievements: boolean;
  enableAchievementSouvenirs: boolean;
  gameRecorderEnabled: boolean;
  gameRecorderResolution: GameRecorderResolution;
  gameRecorderFps: GameRecorderFps;
  gameRecorderQualityPreset: GameRecorderQualityPreset;
  gameRecorderInstantReplayEnabled: boolean;
  gameRecorderReplayDurationSeconds: GameRecorderReplayDuration;
  gameRecorderCaptureAudio: boolean;
  gameRecorderOutputDirectory: string | null;
}

interface ContentItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  secondaryText?: string;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: ContentForm = {
  autoplayGameTrailers: true,
  disableNsfwAlert: false,
  showHiddenAchievementsDescription: false,
  enableSteamAchievements: false,
  enableAchievementSouvenirs: false,
  gameRecorderEnabled: DEFAULT_GAME_RECORDER_PREFERENCES.enabled,
  gameRecorderResolution: DEFAULT_GAME_RECORDER_PREFERENCES.resolution,
  gameRecorderFps: DEFAULT_GAME_RECORDER_PREFERENCES.fps,
  gameRecorderQualityPreset: DEFAULT_GAME_RECORDER_PREFERENCES.qualityPreset,
  gameRecorderInstantReplayEnabled:
    DEFAULT_GAME_RECORDER_PREFERENCES.instantReplayEnabled,
  gameRecorderReplayDurationSeconds:
    DEFAULT_GAME_RECORDER_PREFERENCES.replayDurationSeconds,
  gameRecorderCaptureAudio: DEFAULT_GAME_RECORDER_PREFERENCES.captureGameAudio,
  gameRecorderOutputDirectory:
    DEFAULT_GAME_RECORDER_PREFERENCES.outputDirectory,
};

const RESOLUTION_OPTIONS = [
  { value: "source", label: "Source resolution" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "2160p (4K)" },
] satisfies Array<{ value: GameRecorderResolution; label: string }>;

const FPS_OPTIONS = [30, 60, 120].map((fps) => ({
  value: String(fps),
  label: `${fps} FPS`,
}));

const QUALITY_OPTIONS = [
  { value: "performance", label: "Performance" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "High quality" },
] satisfies Array<{ value: GameRecorderQualityPreset; label: string }>;

const REPLAY_OPTIONS = [15, 30, 45, 60].map((seconds) => ({
  value: String(seconds),
  label: `${seconds} seconds`,
}));

function buildNavigationOverrides(focusIds: string[]) {
  return Object.fromEntries(
    focusIds.map((focusId, index) => {
      const previousId = focusIds[index - 1];
      const nextId = focusIds[index + 1];

      return [
        focusId,
        {
          up: previousId
            ? { type: "item" as const, itemId: previousId }
            : SETTINGS_HEADER_RETURN_TARGET,
          down: nextId
            ? { type: "item" as const, itemId: nextId }
            : { type: "block" as const },
        } satisfies FocusOverrides,
      ];
    })
  );
}

export function ContentSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const userPreferences = useUserPreferences();
  const [form, setForm] = useState<ContentForm>(DEFAULT_FORM);
  const [recorderState, setRecorderState] = useState<GameRecorderState | null>(
    null
  );
  const [isOutputPickerVisible, setIsOutputPickerVisible] = useState(false);

  useEffect(() => {
    if (!userPreferences) return;

    const recorderPreferences = resolveGameRecorderPreferences(userPreferences);
    setForm({
      autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
      disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
      showHiddenAchievementsDescription:
        userPreferences.showHiddenAchievementsDescription ?? false,
      enableSteamAchievements: userPreferences.enableSteamAchievements ?? false,
      enableAchievementSouvenirs:
        userPreferences.enableAchievementSouvenirs ?? false,
      gameRecorderEnabled: recorderPreferences.enabled,
      gameRecorderResolution: recorderPreferences.resolution,
      gameRecorderFps: recorderPreferences.fps,
      gameRecorderQualityPreset: recorderPreferences.qualityPreset,
      gameRecorderInstantReplayEnabled:
        recorderPreferences.instantReplayEnabled,
      gameRecorderReplayDurationSeconds:
        recorderPreferences.replayDurationSeconds,
      gameRecorderCaptureAudio: recorderPreferences.captureGameAudio,
      gameRecorderOutputDirectory: recorderPreferences.outputDirectory,
    });
  }, [userPreferences]);

  useEffect(() => {
    let active = true;
    const applyState = (state: GameRecorderState) => {
      if (active) setRecorderState(state);
    };

    globalThis.window.electron
      .gameRecorderGetPreferences()
      .then(applyState)
      .catch(() => undefined);
    const unsubscribe =
      globalThis.window.electron.onGameRecorderState(applyState);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const updateUserPreferences = (values: Partial<ContentForm>) => {
    setForm((currentForm) => ({ ...currentForm, ...values }));
    void globalThis.window.electron.updateUserPreferences(values);
  };
  const captureCapabilities = getDesktopCaptureUiCapabilities(
    recorderState,
    globalThis.window.electron.platform
  );

  const items = useMemo<ContentItem[]>(() => {
    return [
      {
        id: "autoplay-game-trailers",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        label: "Autoplay trailers on game page",
        checked: form.autoplayGameTrailers,
        onChange: (checked) =>
          updateUserPreferences({ autoplayGameTrailers: checked }),
      },
      {
        id: "disable-nsfw-alert",
        focusId: CONTENT_ITEM_FOCUS_IDS.disableNsfwAlert,
        label: "Disable NSFW alert",
        checked: form.disableNsfwAlert,
        onChange: (checked) =>
          updateUserPreferences({ disableNsfwAlert: checked }),
      },
      {
        id: "show-hidden-achievements-description",
        focusId: CONTENT_ITEM_FOCUS_IDS.showHiddenAchievementsDescription,
        label: "Show hidden achievement description",
        checked: form.showHiddenAchievementsDescription,
        onChange: (checked) =>
          updateUserPreferences({ showHiddenAchievementsDescription: checked }),
      },
      {
        id: "enable-steam-achievements",
        focusId: CONTENT_ITEM_FOCUS_IDS.enableSteamAchievements,
        label: "Enable search for Steam achievements",
        checked: form.enableSteamAchievements,
        onChange: (checked) =>
          updateUserPreferences({ enableSteamAchievements: checked }),
      },
      {
        id: "enable-achievement-souvenirs",
        focusId: CONTENT_ITEM_FOCUS_IDS.enableAchievementSouvenirs,
        label: "Capture achievement souvenirs",
        checked: form.enableAchievementSouvenirs,
        disabled: !captureCapabilities.screenshots,
        secondaryText: !captureCapabilities.screenshots
          ? captureCapabilities.checking
            ? "Checking screenshot capture support for this desktop session."
            : "Automatic capture needs an X11 game window on Linux. Native Wayland capture is not available yet. Existing local and cloud souvenirs remain available in your profile."
          : "Save an achievement screenshot locally and in your private cloud storage.",
        onChange: (checked: boolean) =>
          updateUserPreferences({
            enableAchievementSouvenirs: checked,
          }),
      },
    ];
  }, [form, captureCapabilities.screenshots, captureCapabilities.checking]);

  const spotifySystemAudioBlocked =
    userPreferences?.musicProvider === "spotify";
  const recorderEnabled = form.gameRecorderEnabled;
  const instantReplayEnabled =
    recorderEnabled && form.gameRecorderInstantReplayEnabled;
  const captureFocusIds = [
    CONTENT_CAPTURE_FOCUS_IDS.enabled,
    ...(recorderEnabled
      ? [
          CONTENT_CAPTURE_FOCUS_IDS.instantReplay,
          CONTENT_CAPTURE_FOCUS_IDS.resolution,
          CONTENT_CAPTURE_FOCUS_IDS.fps,
          CONTENT_CAPTURE_FOCUS_IDS.quality,
          ...(instantReplayEnabled
            ? [CONTENT_CAPTURE_FOCUS_IDS.replayDuration]
            : []),
          ...(!spotifySystemAudioBlocked && captureCapabilities.systemAudio
            ? [CONTENT_CAPTURE_FOCUS_IDS.audio]
            : []),
        ]
      : []),
    CONTENT_CAPTURE_FOCUS_IDS.outputDirectory,
    ...(recorderEnabled ? [CONTENT_CAPTURE_FOCUS_IDS.openDirectory] : []),
  ];
  const navigationOverridesByFocusId = buildNavigationOverrides([
    ...items.filter((item) => !item.disabled).map((item) => item.focusId),
    ...captureFocusIds,
  ]);
  const recorderConfiguration = {
    resolution: form.gameRecorderResolution,
    fps: form.gameRecorderFps,
    qualityPreset: form.gameRecorderQualityPreset,
    captureGameAudio: form.gameRecorderCaptureAudio,
    replayDurationSeconds: form.gameRecorderReplayDurationSeconds,
  };
  const targetBitrateMbps = Math.round(
    getGameRecorderVideoBitrate(
      recorderConfiguration,
      null,
      "video/mp4;codecs=avc1"
    ) / 1_000_000
  );
  const replayBufferMegabytes = Math.round(
    getGameRecorderEstimatedBufferBytes(recorderConfiguration) / 1_000_000
  );
  const status = useMemo(
    () =>
      getGameRecorderStatusPresentation(
        recorderState,
        globalThis.window.electron.platform
      ),
    [recorderState]
  );
  const resolvedOutputDirectory =
    form.gameRecorderOutputDirectory ??
    recorderState?.resolvedOutputDirectory ??
    "Resolving capture folder…";

  return (
    <VerticalFocusGroup regionId={CONTENT_SECTION_REGION_ID} asChild>
      <div
        className={
          className
            ? `content-settings-section ${className}`
            : "content-settings-section"
        }
      >
        <SettingsSection
          title="Preferences"
          description="Choose how GameHub handles trailers, content warnings, and achievement details."
        >
          <div className="content-settings-section__content">
            {items.map((item) => (
              <Checkbox
                key={item.id}
                id={item.id}
                label={item.label}
                checked={item.checked}
                disabled={item.disabled}
                secondaryText={item.secondaryText}
                focusId={item.focusId}
                navigationOverrides={navigationOverridesByFocusId[item.focusId]}
                block
                onChange={item.onChange}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Gameplay capture and Instant Replay"
          description="Capture follows the detected foreground game window. Instant Replay stays off until you enable its rolling buffer."
        >
          <div className="content-settings-section__capture">
            <div
              className={`content-settings-section__capture-status content-settings-section__capture-status--${status.tone}`}
              role="status"
              aria-live="polite"
            >
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
              {status.diagnostics ? <span>{status.diagnostics}</span> : null}
            </div>

            <Checkbox
              id="game-recorder-enabled"
              focusId={CONTENT_CAPTURE_FOCUS_IDS.enabled}
              label="Enable gameplay capture"
              secondaryText="Disabled by default. Capture activates only for the foreground game window."
              checked={form.gameRecorderEnabled}
              navigationOverrides={
                navigationOverridesByFocusId[CONTENT_CAPTURE_FOCUS_IDS.enabled]
              }
              block
              onChange={(checked) =>
                updateUserPreferences({ gameRecorderEnabled: checked })
              }
            />

            <Checkbox
              id="game-recorder-instant-replay"
              focusId={CONTENT_CAPTURE_FOCUS_IDS.instantReplay}
              label="Enable Instant Replay"
              checked={form.gameRecorderInstantReplayEnabled}
              disabled={!recorderEnabled}
              navigationOverrides={
                navigationOverridesByFocusId[
                  CONTENT_CAPTURE_FOCUS_IDS.instantReplay
                ]
              }
              block
              onChange={(checked) =>
                updateUserPreferences({
                  gameRecorderInstantReplayEnabled: checked,
                })
              }
            />

            <div className="content-settings-section__capture-grid">
              <DropdownSelect
                label="Recording resolution"
                value={form.gameRecorderResolution}
                options={RESOLUTION_OPTIONS}
                disabled={!recorderEnabled}
                focusId={CONTENT_CAPTURE_FOCUS_IDS.resolution}
                focusNavigationOverrides={
                  navigationOverridesByFocusId[
                    CONTENT_CAPTURE_FOCUS_IDS.resolution
                  ]
                }
                onValueChange={(value) =>
                  updateUserPreferences({ gameRecorderResolution: value })
                }
              />
              <DropdownSelect
                label="Frame rate"
                value={String(form.gameRecorderFps)}
                options={FPS_OPTIONS}
                disabled={!recorderEnabled}
                focusId={CONTENT_CAPTURE_FOCUS_IDS.fps}
                focusNavigationOverrides={
                  navigationOverridesByFocusId[CONTENT_CAPTURE_FOCUS_IDS.fps]
                }
                onValueChange={(value) =>
                  updateUserPreferences({
                    gameRecorderFps: Number(value) as GameRecorderFps,
                  })
                }
              />
              <DropdownSelect
                label="Quality preset"
                value={form.gameRecorderQualityPreset}
                options={QUALITY_OPTIONS}
                disabled={!recorderEnabled}
                focusId={CONTENT_CAPTURE_FOCUS_IDS.quality}
                focusNavigationOverrides={
                  navigationOverridesByFocusId[
                    CONTENT_CAPTURE_FOCUS_IDS.quality
                  ]
                }
                onValueChange={(value) =>
                  updateUserPreferences({ gameRecorderQualityPreset: value })
                }
              />
              <DropdownSelect
                label="Instant Replay length"
                value={String(form.gameRecorderReplayDurationSeconds)}
                options={REPLAY_OPTIONS}
                disabled={!instantReplayEnabled}
                focusId={CONTENT_CAPTURE_FOCUS_IDS.replayDuration}
                focusNavigationOverrides={
                  navigationOverridesByFocusId[
                    CONTENT_CAPTURE_FOCUS_IDS.replayDuration
                  ]
                }
                onValueChange={(value) =>
                  updateUserPreferences({
                    gameRecorderReplayDurationSeconds: Number(
                      value
                    ) as GameRecorderReplayDuration,
                  })
                }
              />
            </div>

            <p className="content-settings-section__capture-hint">
              Current quality target: about {targetBitrateMbps} Mbps. The
              rolling buffer uses about {replayBufferMegabytes} MB at the
              selected replay length.
            </p>

            <Checkbox
              id="game-recorder-capture-audio"
              focusId={CONTENT_CAPTURE_FOCUS_IDS.audio}
              label="Capture system audio"
              secondaryText={
                spotifySystemAudioBlocked
                  ? "Unavailable while Spotify Connect is selected, keeping Spotify audio out of recordings."
                  : !captureCapabilities.systemAudio
                    ? "This capture backend records video only; system audio is unavailable in this desktop session."
                    : "Records system audio while the game is in the foreground, when supported by the capture backend."
              }
              checked={
                spotifySystemAudioBlocked || !captureCapabilities.systemAudio
                  ? false
                  : form.gameRecorderCaptureAudio
              }
              disabled={
                !recorderEnabled ||
                spotifySystemAudioBlocked ||
                !captureCapabilities.systemAudio
              }
              navigationOverrides={
                navigationOverridesByFocusId[CONTENT_CAPTURE_FOCUS_IDS.audio]
              }
              block
              onChange={(checked) =>
                updateUserPreferences({ gameRecorderCaptureAudio: checked })
              }
            />

            <div className="content-settings-section__output">
              <div className="content-settings-section__output-copy">
                <span>Capture output directory</span>
                <strong title={resolvedOutputDirectory}>
                  {resolvedOutputDirectory}
                </strong>
              </div>
              <div className="content-settings-section__output-actions">
                <Button
                  variant="secondary"
                  focusId={CONTENT_CAPTURE_FOCUS_IDS.outputDirectory}
                  focusNavigationOverrides={
                    navigationOverridesByFocusId[
                      CONTENT_CAPTURE_FOCUS_IDS.outputDirectory
                    ]
                  }
                  onClick={() => setIsOutputPickerVisible(true)}
                >
                  Change folder
                </Button>
                <Button
                  variant="secondary"
                  disabled={!recorderEnabled}
                  focusId={CONTENT_CAPTURE_FOCUS_IDS.openDirectory}
                  focusNavigationOverrides={
                    navigationOverridesByFocusId[
                      CONTENT_CAPTURE_FOCUS_IDS.openDirectory
                    ]
                  }
                  onClick={() =>
                    void globalThis.window.electron.gameRecorderOpenOutputDirectory()
                  }
                >
                  Open folder
                </Button>
              </div>
            </div>
          </div>
        </SettingsSection>

        <FileExplorerModal
          visible={isOutputPickerVisible}
          title="Choose capture output directory"
          initialPath={resolvedOutputDirectory}
          selectDirectory
          onClose={() => setIsOutputPickerVisible(false)}
          onSelect={(path) => {
            updateUserPreferences({ gameRecorderOutputDirectory: path });
            setIsOutputPickerVisible(false);
          }}
        />
      </div>
    </VerticalFocusGroup>
  );
}
