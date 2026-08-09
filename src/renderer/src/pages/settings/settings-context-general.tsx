import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "i18next";
import { orderBy } from "lodash-es";

import {
  Button,
  CheckboxField,
  ProgressBar,
  SectionHeading,
  SelectField,
  TextField,
} from "@renderer/components";
import type { DownloadDirectoryPreference } from "@types";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import languageResources from "@locales";
import {
  prepareDefaultDownloadPathSync,
  replaceSavedDownloadDirectoryAndSetDefault,
} from "@shared";
import { SettingsAppearance } from "./appearance/settings-appearance";
import { DownloadDirectoryReplacementModal } from "./download-directory-replacement-modal";
import { LibrarySyncModal, type LibrarySyncResult } from "./library-sync-modal";
import { CloudDebuggerModal } from "./cloud-debugger-modal";
import { SettingsMaintenanceFlow } from "./settings-maintenance-flow";
import type { CloudDebugReport } from "@types";

interface LanguageOption {
  option: string;
  nativeName: string;
}

interface SettingsContextGeneralProps {
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

interface DownloadDirectoryReplacementState {
  nextPath: string;
  replaceableDirectories: DownloadDirectoryPreference[];
  selectedReplacementPath: string;
}

export function SettingsContextGeneral({
  appearance,
}: Readonly<SettingsContextGeneralProps>) {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const [showRunAtStartup, setShowRunAtStartup] = useState(false);
  const [downloadDirectoryReplacement, setDownloadDirectoryReplacement] =
    useState<DownloadDirectoryReplacementState | null>(null);

  const { showSuccessToast, showErrorToast } = useToast();
  const [generatingMetadata, setGeneratingMetadata] = useState(false);
  const [clearingLibrary, setClearingLibrary] = useState(false);
  const [clearLibraryConfirm, setClearLibraryConfirm] = useState(false);
  const [deletingCloudLibrary, setDeletingCloudLibrary] = useState(false);
  const [deleteCloudLibraryConfirm, setDeleteCloudLibraryConfirm] =
    useState(false);
  const [metadataProgress, setMetadataProgress] = useState<{
    current: number;
    total: number;
    title: string | null;
  } | null>(null);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<string | null>(
    null
  );
  const updateUnsubRef = useRef<(() => void) | null>(null);

  const [deduping, setDeduping] = useState(false);
  const [dedupProgress, setDedupProgress] = useState<{
    current: number;
    total: number;
    title: string | null;
  } | null>(null);
  const [syncModal, setSyncModal] = useState<{
    heading: string;
    summary: string;
    results: LibrarySyncResult[];
  } | null>(null);

  const [debuggingCloud, setDebuggingCloud] = useState(false);
  const [cloudDebugReport, setCloudDebugReport] =
    useState<CloudDebugReport | null>(null);

  const [form, setForm] = useState({
    downloadsPath: "",
    language: "",
    preferQuitInsteadOfHiding: false,
    runAtStartup: false,
    startMinimized: false,
    hideToTrayOnGameStart: false,
    launchToLibraryPage: false,
    launchInBigPicture: false,
    enableAutoInstall: false,
  });

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });

    window.electron.isPortableVersion().then((isPortableVersion) => {
      setShowRunAtStartup(!isPortableVersion);
    });

    setLanguageOptions(
      orderBy(
        Object.entries(languageResources).map(([language, value]) => ({
          nativeName: value.language_name,
          option: language,
        })),
        ["nativeName"],
        "asc"
      )
    );
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    const languageKeys = Object.keys(languageResources);
    const language =
      languageKeys.find((language) => language === userPreferences.language) ??
      languageKeys.find((language) => {
        return language.startsWith(
          userPreferences.language?.split("-")[0] ?? "en"
        );
      });

    setForm({
      downloadsPath: userPreferences.downloadsPath ?? defaultDownloadsPath,
      language: language ?? "en",
      preferQuitInsteadOfHiding:
        userPreferences.preferQuitInsteadOfHiding ?? false,
      runAtStartup: userPreferences.runAtStartup ?? false,
      startMinimized: userPreferences.startMinimized ?? false,
      hideToTrayOnGameStart: userPreferences.hideToTrayOnGameStart ?? false,
      launchToLibraryPage: userPreferences.launchToLibraryPage ?? false,
      launchInBigPicture: userPreferences.launchInBigPicture ?? false,
      enableAutoInstall: userPreferences.enableAutoInstall ?? false,
    });
  }, [userPreferences, defaultDownloadsPath]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;
    handleChange({ language: value });
    changeLanguage(value);
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

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("app_basics")}</h3>

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
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("startup_behavior")}</h3>

        <CheckboxField
          label={t("quit_app_instead_hiding")}
          checked={form.preferQuitInsteadOfHiding}
          onChange={() =>
            handleChange({
              preferQuitInsteadOfHiding: !form.preferQuitInsteadOfHiding,
            })
          }
        />

        <CheckboxField
          label={t("hide_to_tray_on_game_start")}
          checked={form.hideToTrayOnGameStart}
          onChange={() =>
            handleChange({
              hideToTrayOnGameStart: !form.hideToTrayOnGameStart,
            })
          }
        />

        {showRunAtStartup && (
          <CheckboxField
            label={t("launch_with_system")}
            onChange={() => {
              handleChange({ runAtStartup: !form.runAtStartup });
              window.electron.autoLaunch({
                enabled: !form.runAtStartup,
                minimized: form.startMinimized,
              });
            }}
            checked={form.runAtStartup}
          />
        )}

        {showRunAtStartup && (
          <CheckboxField
            label={t("launch_minimized")}
            style={{ cursor: form.runAtStartup ? "pointer" : "not-allowed" }}
            checked={form.runAtStartup && form.startMinimized}
            disabled={!form.runAtStartup}
            onChange={() => {
              handleChange({ startMinimized: !form.startMinimized });
              window.electron.autoLaunch({
                minimized: !form.startMinimized,
                enabled: form.runAtStartup,
              });
            }}
          />
        )}

        <CheckboxField
          label={t("launch_hydra_in_library_page")}
          checked={form.launchToLibraryPage}
          onChange={() =>
            handleChange({
              launchToLibraryPage: !form.launchToLibraryPage,
            })
          }
        />

        <CheckboxField
          label={t("launch_hydra_in_big_picture")}
          checked={form.launchInBigPicture}
          onChange={() =>
            handleChange({
              launchInBigPicture: !form.launchInBigPicture,
            })
          }
        />
      </div>

      {window.electron.platform === "linux" && (
        <div className="settings-context-panel__group">
          <h3>{t("behavior")}</h3>

          <CheckboxField
            label={t("enable_auto_install")}
            checked={form.enableAutoInstall}
            onChange={() =>
              handleChange({ enableAutoInstall: !form.enableAutoInstall })
            }
          />
        </div>
      )}

      <div className="settings-context-panel__group">
        <h3>{t("appearance")}</h3>
        <SelectField
          label={t("theme_mode", { defaultValue: "Theme" })}
          value={userPreferences?.themeMode ?? "dark"}
          onChange={(event) => {
            const themeMode = event.target.value as NonNullable<
              typeof userPreferences
            >["themeMode"];
            // Apply instantly, then persist.
            document.documentElement.setAttribute(
              "data-theme-mode",
              themeMode ?? "dark"
            );
            updateUserPreferences({ themeMode });
          }}
          options={[
            {
              key: "dark",
              value: "dark",
              label: t("theme_dark", { defaultValue: "Dark" }),
            },
            {
              key: "light",
              value: "light",
              label: t("theme_light", { defaultValue: "Light" }),
            },
            {
              key: "system",
              value: "system",
              label: t("theme_system", { defaultValue: "Follow system" }),
            },
          ]}
        />
        <SettingsAppearance appearance={appearance} />
      </div>

      <div className="settings-context-panel__group">
        <SectionHeading
          title="Library"
          hint="Maintenance tools for your local game library."
        />

        <div className="settings-general-action-row">
          <div className="settings-general-action-row__info">
            <span>Generate missing artwork</span>
            <small>
              Fetch covers from SteamGridDB for games without images
            </small>
          </div>
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
                setSyncModal({
                  heading: "Metadata Generation Complete",
                  summary:
                    result.updated > 0
                      ? `Updated ${result.updated} game${result.updated !== 1 ? "s" : ""}, ${result.skipped} already healthy${result.failed ? `, ${result.failed} failed` : ""}.`
                      : result.failed > 0
                        ? `No repairs completed. ${result.failed} game${result.failed !== 1 ? "s" : ""} still need artwork; ${result.skipped} were already healthy.`
                        : `No repairs needed. All ${result.skipped} games have working artwork.`,
                  results: result.results.map((r) => ({
                    title: r.title,
                    coverUrl: r.coverUrl,
                    what: r.what,
                    isNew: r.status === "updated",
                  })),
                });
              } catch {
                showErrorToast("Failed to generate metadata.");
              } finally {
                unsub();
                setGeneratingMetadata(false);
                setMetadataProgress(null);
              }
            }}
            disabled={generatingMetadata}
          >
            {generatingMetadata ? "Generating…" : "Generate"}
          </Button>
        </div>
        {generatingMetadata && metadataProgress && (
          <ProgressBar
            current={metadataProgress.current}
            total={metadataProgress.total}
            label={`${metadataProgress.current}/${metadataProgress.total}${metadataProgress.title ? ` — ${metadataProgress.title}` : ""}`}
          />
        )}

        <div className="settings-general-action-row">
          <div className="settings-general-action-row__info">
            <span>Check for duplicates</span>
            <small>
              Merge duplicate library entries, preserving download links
            </small>
          </div>
          <Button
            theme="outline"
            onClick={async () => {
              setDeduping(true);
              setDedupProgress(null);
              const unsub = window.electron.onDedupProgress((p) => {
                setDedupProgress({
                  current: p.current,
                  total: p.total,
                  title: p.title,
                });
              });
              try {
                const result = await window.electron.mergeDuplicateGames();
                setSyncModal({
                  heading: "Duplicate Check Complete",
                  summary:
                    result.merged > 0
                      ? `Merged ${result.merged} duplicate game${result.merged !== 1 ? "s" : ""}.`
                      : "No duplicates found.",
                  results: result.mergedTitles.map((title) => ({
                    title,
                    coverUrl: null,
                    what: "Duplicate entries merged — download options preserved",
                  })),
                });
              } catch {
                showErrorToast("Failed to merge duplicates.");
              } finally {
                unsub();
                setDeduping(false);
                setDedupProgress(null);
              }
            }}
            disabled={deduping}
          >
            {deduping ? "Checking…" : "Check"}
          </Button>
        </div>
        {deduping && dedupProgress && (
          <ProgressBar
            current={dedupProgress.current}
            total={dedupProgress.total}
            label={`${dedupProgress.current}/${dedupProgress.total}${dedupProgress.title ? ` — ${dedupProgress.title}` : ""}`}
          />
        )}
      </div>

      <div className="settings-context-panel__group">
        <SectionHeading
          title="Cloud Sync"
          hint="Diagnose and repair discrepancies between your local library and GameHub cloud."
        />

        <SettingsMaintenanceFlow />

        <div className="settings-general-action-row">
          <div className="settings-general-action-row__info">
            <span>GameHub API Debugger</span>
            <small>
              Compare local library vs cloud — finds missing games, missing
              achievements, playtime gaps, and attempts to auto-fix them.
            </small>
          </div>
          <Button
            theme="outline"
            disabled={debuggingCloud}
            onClick={async () => {
              setDebuggingCloud(true);
              try {
                const report = await window.electron.runCloudDebugger();
                setCloudDebugReport(report);
              } catch {
                showErrorToast("Debugger failed — check your connection.");
              } finally {
                setDebuggingCloud(false);
              }
            }}
          >
            {debuggingCloud ? "Running…" : "Run"}
          </Button>
        </div>
      </div>

      <div className="settings-context-panel__group settings-context-panel__group--danger">
        <SectionHeading
          title="Danger Zone"
          hint="These actions are permanent and cannot be undone."
          danger
        />

        <div className="settings-general-action-row settings-general-action-row--danger">
          <div className="settings-general-action-row__info">
            <span>Delete local library</span>
            <small>
              Removes every game from this device. Useful for a fresh start
              before re-syncing.
            </small>
          </div>
          {!clearLibraryConfirm ? (
            <Button theme="danger" onClick={() => setClearLibraryConfirm(true)}>
              Delete
            </Button>
          ) : (
            <div className="settings-general-action-row__confirm">
              <Button
                theme="danger"
                disabled={clearingLibrary}
                onClick={async () => {
                  setClearingLibrary(true);
                  try {
                    const result = await window.electron.clearLibrary();
                    showSuccessToast(
                      "Library cleared",
                      `${result.cleared} game${result.cleared !== 1 ? "s" : ""} removed.`
                    );
                  } catch {
                    showErrorToast("Failed to clear library.");
                  } finally {
                    setClearingLibrary(false);
                    setClearLibraryConfirm(false);
                  }
                }}
              >
                {clearingLibrary ? "Clearing…" : "Confirm"}
              </Button>
              <Button
                theme="outline"
                disabled={clearingLibrary}
                onClick={() => setClearLibraryConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        <div className="settings-general-action-row settings-general-action-row--danger">
          <div className="settings-general-action-row__info">
            <span>Delete cloud library</span>
            <small>
              Removes all games from your GameHub account server-side. Stops old
              imports from restoring on login. Does not affect this device.
            </small>
          </div>
          {!deleteCloudLibraryConfirm ? (
            <Button
              theme="danger"
              onClick={() => setDeleteCloudLibraryConfirm(true)}
            >
              Delete
            </Button>
          ) : (
            <div className="settings-general-action-row__confirm">
              <Button
                theme="danger"
                disabled={deletingCloudLibrary}
                onClick={async () => {
                  setDeletingCloudLibrary(true);
                  try {
                    const result = await window.electron.deleteCloudLibrary();
                    if (result.error === "not-logged-in") {
                      showErrorToast("You must be logged in to GameHub.");
                    } else {
                      showSuccessToast(
                        "Cloud library cleared",
                        `${result.deleted} game${result.deleted !== 1 ? "s" : ""} removed from your GameHub account.`
                      );
                    }
                  } catch {
                    showErrorToast("Failed to clear cloud library.");
                  } finally {
                    setDeletingCloudLibrary(false);
                    setDeleteCloudLibraryConfirm(false);
                  }
                }}
              >
                {deletingCloudLibrary ? "Deleting…" : "Confirm"}
              </Button>
              <Button
                theme="outline"
                disabled={deletingCloudLibrary}
                onClick={() => setDeleteCloudLibraryConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="settings-context-panel__group">
        <SectionHeading title={t("updates", { defaultValue: "Updates" })} />
        <div className="settings-general-action-row">
          <div className="settings-general-action-row__info">
            <span>Check for updates</span>
            <small>
              {updateCheckResult ?? "Look for a newer version of GameHub"}
            </small>
          </div>
          <Button
            theme="outline"
            onClick={async () => {
              updateUnsubRef.current?.();
              setCheckingForUpdates(true);
              setUpdateCheckResult(null);
              try {
                const isAutoInstall = await window.electron.checkForUpdates();
                updateUnsubRef.current = window.electron.onAutoUpdaterEvent(
                  (event) => {
                    if (event.type === "update-available") {
                      setUpdateCheckResult(
                        `Update available: v${event.info.version}`
                      );
                    } else if (event.type === "update-downloaded") {
                      setUpdateCheckResult(
                        "Update downloaded — restart to install."
                      );
                    }
                    updateUnsubRef.current?.();
                  }
                );
                if (!isAutoInstall) {
                  setTimeout(() => {
                    setUpdateCheckResult(
                      (prev) => prev ?? "No new update found."
                    );
                  }, 8000);
                }
              } finally {
                setCheckingForUpdates(false);
              }
            }}
            disabled={checkingForUpdates}
          >
            {checkingForUpdates
              ? t("checking_for_updates", { defaultValue: "Checking…" })
              : t("check_for_updates", { defaultValue: "Check" })}
          </Button>
        </div>
      </div>

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

      {cloudDebugReport && (
        <CloudDebuggerModal
          report={cloudDebugReport}
          onClose={() => setCloudDebugReport(null)}
        />
      )}

      {syncModal && (
        <LibrarySyncModal
          visible={true}
          heading={syncModal.heading}
          summary={syncModal.summary}
          results={syncModal.results}
          onClose={() => setSyncModal(null)}
        />
      )}
    </div>
  );
}
