import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  TextField,
  Button,
  CheckboxField,
  SelectField,
} from "@renderer/components";
import type { DownloadDirectoryPreference } from "@types";
import { useTranslation } from "react-i18next";
import { useAppSelector, useToast } from "@renderer/hooks";
import { changeLanguage } from "i18next";
import languageResources from "@locales";
import { orderBy } from "lodash-es";
import { settingsContext } from "@renderer/context";
import "./settings-general.scss";
import { DesktopDownloadIcon, UnmuteIcon } from "@primer/octicons-react";
import { logger } from "@renderer/logger";
import { AchievementCustomNotificationPosition } from "@types";
import {
  prepareDefaultDownloadPathSync,
  replaceSavedDownloadDirectoryAndSetDefault,
} from "@shared";
import { DownloadDirectoryReplacementModal } from "./download-directory-replacement-modal";

interface LanguageOption {
  option: string;
  nativeName: string;
}

interface DownloadDirectoryReplacementState {
  nextPath: string;
  replaceableDirectories: DownloadDirectoryPreference[];
  selectedReplacementPath: string;
}

export function SettingsGeneral() {
  const { t } = useTranslation("settings");

  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast } = useToast();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(
    null
  );
  const [clearingLibrary, setClearingLibrary] = useState(false);
  const [clearLibraryConfirm, setClearLibraryConfirm] = useState(false);

  const [generatingMetadata, setGeneratingMetadata] = useState(false);
  const [metadataProgress, setMetadataProgress] = useState<{
    current: number;
    total: number;
    title: string | null;
  } | null>(null);

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    friendRequestNotificationsEnabled: false,
    friendStartGameNotificationsEnabled: true,
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    achievementSoundVolume: 15,
    language: "",
    customStyles: window.localStorage.getItem("customStyles") || "",
  });

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);

  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const [downloadDirectoryReplacement, setDownloadDirectoryReplacement] =
    useState<DownloadDirectoryReplacementState | null>(null);

  const volumeUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });

    window.electron.canInstallCommonRedist().then((canInstall) => {
      setCanInstallCommonRedist(canInstall);
    });

    const redistInterval = setInterval(() => {
      window.electron.canInstallCommonRedist().then((canInstall) => {
        setCanInstallCommonRedist(canInstall);
      });
    }, 1000 * 5);

    setLanguageOptions(
      orderBy(
        Object.entries(languageResources).map(([language, value]) => {
          return {
            nativeName: value.language_name,
            option: language,
          };
        }),
        ["nativeName"],
        "asc"
      )
    );

    return () => {
      clearInterval(redistInterval);
      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (userPreferences) {
      const languageKeys = Object.keys(languageResources);
      const language =
        languageKeys.find(
          (language) => language === userPreferences.language
        ) ??
        languageKeys.find((language) => {
          return language.startsWith(
            userPreferences.language?.split("-")[0] ?? "en"
          );
        });

      setForm((prev) => ({
        ...prev,
        downloadsPath: userPreferences.downloadsPath ?? defaultDownloadsPath,
        downloadNotificationsEnabled:
          userPreferences.downloadNotificationsEnabled ?? false,
        repackUpdatesNotificationsEnabled:
          userPreferences.repackUpdatesNotificationsEnabled ?? false,
        achievementNotificationsEnabled:
          userPreferences.achievementNotificationsEnabled ?? true,
        achievementCustomNotificationsEnabled:
          userPreferences.achievementCustomNotificationsEnabled ?? true,
        achievementCustomNotificationPosition:
          userPreferences.achievementCustomNotificationPosition ?? "top-left",
        achievementSoundVolume: Math.round(
          (userPreferences.achievementSoundVolume ?? 0.15) * 100
        ),
        friendRequestNotificationsEnabled:
          userPreferences.friendRequestNotificationsEnabled ?? false,
        friendStartGameNotificationsEnabled:
          userPreferences.friendStartGameNotificationsEnabled ?? true,
        language: language ?? "en",
      }));
    }
  }, [userPreferences, defaultDownloadsPath]);

  const achievementCustomNotificationPositionOptions = useMemo(() => {
    return [
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ].map((position) => ({
      key: position,
      value: position,
      label: t(position),
    }));
  }, [t]);

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;

    handleChange({ language: value });
    changeLanguage(value);
  };

  const handleChange = async (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    await updateUserPreferences(values);
  };

  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      setForm((prev) => ({ ...prev, achievementSoundVolume: newVolume }));

      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }

      volumeUpdateTimeoutRef.current = setTimeout(() => {
        updateUserPreferences({ achievementSoundVolume: newVolume / 100 });
      }, 300);
    },
    [updateUserPreferences]
  );

  const handleChangeAchievementCustomNotificationPosition = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value as AchievementCustomNotificationPosition;

    await handleChange({ achievementCustomNotificationPosition: value });

    window.electron.updateAchievementCustomNotificationWindow();
  };

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    const path = filePaths?.[0];

    if (!path || !defaultDownloadsPath) {
      return;
    }

    const nextAction = prepareDefaultDownloadPathSync(
      userPreferences,
      path,
      defaultDownloadsPath
    );

    if (nextAction.type === "noop") {
      return;
    }

    if (
      nextAction.type === "set-existing" ||
      nextAction.type === "add-and-set"
    ) {
      setForm((prev) => ({
        ...prev,
        downloadsPath: nextAction.nextDefaultPath,
      }));
      await updateUserPreferences(nextAction.nextPreferences);
      return;
    }

    setDownloadDirectoryReplacement({
      nextPath: nextAction.nextPath,
      replaceableDirectories: nextAction.replaceableDirectories,
      selectedReplacementPath: nextAction.recommendedReplacementPath,
    });
  };

  const handleConfirmDownloadDirectoryReplacement = async () => {
    if (!downloadDirectoryReplacement || !defaultDownloadsPath) {
      return;
    }

    const replacement = replaceSavedDownloadDirectoryAndSetDefault(
      userPreferences,
      downloadDirectoryReplacement.nextPath,
      downloadDirectoryReplacement.selectedReplacementPath,
      defaultDownloadsPath
    );

    setForm((prev) => ({
      ...prev,
      downloadsPath: replacement.nextDefaultPath,
    }));
    setDownloadDirectoryReplacement(null);
    await updateUserPreferences(replacement.nextPreferences);
  };

  useEffect(() => {
    const unlisten = window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setInstallingCommonRedist(false);
        }
      }
    );

    return () => unlisten();
  }, []);

  const handleInstallCommonRedist = async () => {
    setInstallingCommonRedist(true);
    try {
      await window.electron.installCommonRedist();
    } catch (err) {
      logger.error(err);
      setInstallingCommonRedist(false);
    }
  };

  return (
    <div className="settings-general">
      <TextField
        label={t("downloads_path")}
        value={form.downloadsPath}
        readOnly
        disabled
        rightContent={
          <Button theme="outline" onClick={handleChooseDownloadsPath}>
            {t("change")}
          </Button>
        }
      />

      <SelectField
        label={t("language")}
        value={form.language}
        onChange={handleLanguageChange}
        options={languageOptions.map((language) => ({
          key: language.option,
          value: language.option,
          label: language.nativeName,
        }))}
      />

      <h2 className="settings-general__section-title">{t("downloads")}</h2>

      <h2 className="settings-general__section-title">{t("notifications")}</h2>

      <CheckboxField
        label={t("enable_download_notifications")}
        checked={form.downloadNotificationsEnabled}
        onChange={() =>
          handleChange({
            downloadNotificationsEnabled: !form.downloadNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_repack_list_notifications")}
        checked={form.repackUpdatesNotificationsEnabled}
        onChange={() =>
          handleChange({
            repackUpdatesNotificationsEnabled:
              !form.repackUpdatesNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_friend_request_notifications")}
        checked={form.friendRequestNotificationsEnabled}
        onChange={() =>
          handleChange({
            friendRequestNotificationsEnabled:
              !form.friendRequestNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_friend_start_game_notifications")}
        checked={form.friendStartGameNotificationsEnabled}
        onChange={() =>
          handleChange({
            friendStartGameNotificationsEnabled:
              !form.friendStartGameNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_achievement_notifications")}
        checked={form.achievementNotificationsEnabled}
        onChange={async () => {
          await handleChange({
            achievementNotificationsEnabled:
              !form.achievementNotificationsEnabled,
          });

          window.electron.updateAchievementCustomNotificationWindow();
        }}
      />

      <CheckboxField
        label={t("enable_achievement_custom_notifications")}
        checked={form.achievementCustomNotificationsEnabled}
        disabled={!form.achievementNotificationsEnabled}
        onChange={async () => {
          await handleChange({
            achievementCustomNotificationsEnabled:
              !form.achievementCustomNotificationsEnabled,
          });

          window.electron.updateAchievementCustomNotificationWindow();
        }}
      />

      {form.achievementNotificationsEnabled &&
        form.achievementCustomNotificationsEnabled && (
          <>
            <SelectField
              className="settings-general__achievement-custom-notification-position__select-variation"
              label={t("achievement_custom_notification_position")}
              value={form.achievementCustomNotificationPosition}
              onChange={handleChangeAchievementCustomNotificationPosition}
              options={achievementCustomNotificationPositionOptions}
            />

            <Button
              className="settings-general__test-achievement-notification-button"
              onClick={() => window.electron.showAchievementTestNotification()}
            >
              {t("test_notification")}
            </Button>
          </>
        )}

      {form.achievementNotificationsEnabled && (
        <div className="settings-general__volume-control">
          <label htmlFor="achievement-volume">
            {t("achievement_sound_volume")}
          </label>
          <div className="settings-general__volume-slider-wrapper">
            <UnmuteIcon size={16} className="settings-general__volume-icon" />
            <input
              id="achievement-volume"
              type="range"
              min="0"
              max="100"
              value={form.achievementSoundVolume}
              onChange={(e) => {
                const volumePercent = parseInt(e.target.value, 10);
                if (!isNaN(volumePercent)) {
                  handleVolumeChange(volumePercent);
                }
              }}
              className="settings-general__volume-slider"
              style={
                {
                  "--volume-percent": `${form.achievementSoundVolume}%`,
                } as React.CSSProperties
              }
            />
            <span className="settings-general__volume-value">
              {form.achievementSoundVolume}%
            </span>
          </div>
        </div>
      )}

      <h2 className="settings-general__section-title">{t("common_redist")}</h2>

      <p className="settings-general__common-redist-description">
        {t("common_redist_description")}
      </p>

      <Button
        onClick={handleInstallCommonRedist}
        className="settings-general__common-redist-button"
        disabled={!canInstallCommonRedist || installingCommonRedist}
      >
        <DesktopDownloadIcon />
        {installingCommonRedist
          ? t("installing_common_redist")
          : t("install_common_redist")}
      </Button>

      <h2 className="settings-general__section-title">Library</h2>

      <p className="settings-general__common-redist-description">
        Fetch artwork and metadata from SteamGridDB for all library games that
        are missing cover images.
      </p>

      <Button
        onClick={async () => {
          setGeneratingMetadata(true);
          setMetadataProgress(null);
          const unsub = window.electron.onMetadataProgress((p) => {
            setMetadataProgress({
              current: p.current,
              total: p.total,
              title: p.title,
            });
          });
          try {
            const result = await window.electron.generateMissingMetadata();
            showSuccessToast(
              `Metadata updated for ${result.updated} game${result.updated !== 1 ? "s" : ""}, skipped ${result.skipped}.`
            );
          } catch {
            showErrorToast("Failed to generate metadata.");
          } finally {
            unsub();
            setGeneratingMetadata(false);
            setMetadataProgress(null);
          }
        }}
        className="settings-general__common-redist-button"
        disabled={generatingMetadata}
      >
        <DesktopDownloadIcon />
        {generatingMetadata
          ? "Generating metadata…"
          : "Generate missing metadata"}
      </Button>
      {generatingMetadata && metadataProgress && (
        <div
          style={{
            fontSize: "0.8rem",
            opacity: 0.7,
            marginTop: 4,
            maxWidth: 400,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                flex: 1,
                height: 4,
                background: "rgba(255,255,255,0.1)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${metadataProgress.total > 0 ? Math.round((metadataProgress.current / metadataProgress.total) * 100) : 0}%`,
                  background: "var(--color-muted-purple, #7b68ee)",
                  transition: "width 0.2s",
                }}
              />
            </div>
            <span style={{ whiteSpace: "nowrap" }}>
              {metadataProgress.current}/{metadataProgress.total}
            </span>
          </div>
          {metadataProgress.title && (
            <p
              style={{
                margin: "4px 0 0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {metadataProgress.title}
            </p>
          )}
        </div>
      )}

      <p className="settings-general__common-redist-description" style={{ color: "var(--color-danger, #e05c5c)" }}>
        Permanently removes all games from your local library. This cannot be undone.
      </p>

      {!clearLibraryConfirm ? (
        <Button
          onClick={() => setClearLibraryConfirm(true)}
          className="settings-general__common-redist-button"
          type="button"
          theme="outline"
          style={{ borderColor: "var(--color-danger, #e05c5c)", color: "var(--color-danger, #e05c5c)" }}
        >
          Delete Entire Library
        </Button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "0.9em", opacity: 0.8 }}>Are you sure?</span>
          <Button
            onClick={async () => {
              setClearingLibrary(true);
              try {
                const result = await window.electron.clearLibrary();
                showSuccessToast(`Library cleared — ${result.cleared} game${result.cleared !== 1 ? "s" : ""} removed.`);
              } catch {
                showErrorToast("Failed to clear library.");
              } finally {
                setClearingLibrary(false);
                setClearLibraryConfirm(false);
              }
            }}
            type="button"
            disabled={clearingLibrary}
            style={{ background: "var(--color-danger, #e05c5c)", color: "#fff" }}
          >
            {clearingLibrary ? "Clearing…" : "Yes, delete all"}
          </Button>
          <Button
            onClick={() => setClearLibraryConfirm(false)}
            type="button"
            theme="outline"
            disabled={clearingLibrary}
          >
            Cancel
          </Button>
        </div>
      )}

      <h2 className="settings-general__section-title">Updates</h2>
      <p className="settings-general__common-redist-description">
        Check if a new version of GameHub is available.
      </p>
      <Button
        onClick={async () => {
          setCheckingForUpdates(true);
          setUpdateCheckResult(null);
          try {
            const isAutoInstall = await window.electron.checkForUpdates();
            const unsubscribe = window.electron.onAutoUpdaterEvent((event) => {
              if (event.type === "update-available") {
                setUpdateCheckResult(
                  `Update available: v${event.info.version}`
                );
              } else if (event.type === "update-downloaded") {
                setUpdateCheckResult("Update downloaded — restart to install.");
              }
              unsubscribe();
            });
            if (!isAutoInstall) {
              setTimeout(() => {
                setUpdateCheckResult(
                  (prev) => prev ?? "No update found (or check in progress)."
                );
              }, 8000);
            }
          } finally {
            setCheckingForUpdates(false);
          }
        }}
        className="settings-general__common-redist-button"
        type="button"
        disabled={checkingForUpdates}
      >
        {checkingForUpdates ? "Checking…" : "Check for Updates"}
      </Button>
      {updateCheckResult && (
        <p className="settings-general__common-redist-description">
          {updateCheckResult}
        </p>
      )}

      <h2 className="settings-general__section-title">Debugging</h2>
      <p className="settings-general__common-redist-description">
        Open a separate console window showing real-time logs from all
        processes. Shortcut: Ctrl+Shift+L
      </p>
      <Button
        onClick={() => window.electron.openConsoleWindow()}
        className="settings-general__common-redist-button"
        type="button"
      >
        Open Debug Console
      </Button>

      <DownloadDirectoryReplacementModal
        visible={downloadDirectoryReplacement !== null}
        nextPath={downloadDirectoryReplacement?.nextPath ?? ""}
        directories={downloadDirectoryReplacement?.replaceableDirectories ?? []}
        selectedReplacementPath={
          downloadDirectoryReplacement?.selectedReplacementPath ?? ""
        }
        onSelectedReplacementPathChange={(path) => {
          setDownloadDirectoryReplacement((current) =>
            current
              ? {
                  ...current,
                  selectedReplacementPath: path,
                }
              : current
          );
        }}
        onClose={() => setDownloadDirectoryReplacement(null)}
        onConfirm={handleConfirmDownloadDirectoryReplacement}
      />
    </div>
  );
}
