import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileDirectoryIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";

import {
  Button,
  CheckboxField,
  ClassicsScanIndicator,
  ConfirmationModal,
} from "@renderer/components";
import { useClassicsScan, useToast } from "@renderer/hooks";
import type { EmulatorConfigMap, EmulatorSystem, RomFolder } from "@types";

import type { EmulatorEntry } from "./emulator-registry";
import { PLATFORM_LABELS } from "@renderer/assets/emulation/platform-logos";
import { EmulatorSettingsSection } from "./emulator-settings-section";
import { ControllerMappingSection } from "./controller-mapping-section";
import { RomsDetectedSection } from "./roms-detected-section";
import { MemoryCardsSection } from "./memory-cards-section";
import { CloudSavesSection } from "./cloud-saves-section";
import { formatRelativeShort } from "./relative-time";
import { PlatformLogo } from "./platform-logo";
import { EmulatorSetupModal } from "./setup/emulator-setup-modal";

import "./emulator-manager-view.scss";

type PlatformSubTab =
  | "settings"
  | "controls"
  | "rom-folders"
  | "memory-cards"
  | "library";

interface Props {
  emulator: EmulatorEntry;
  configs: EmulatorConfigMap;
  onBack: () => void;
  onChange: (configs: EmulatorConfigMap) => void;
  refresh: () => Promise<EmulatorConfigMap>;
}

export function EmulatorManagerView({
  emulator,
  configs,
  onBack,
  onChange,
  refresh,
}: Readonly<Props>) {
  const { t, i18n } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { scan, start } = useClassicsScan();

  const [activePlatform, setActivePlatform] = useState<EmulatorSystem>(
    emulator.systems[0]
  );
  const [subTab, setSubTab] = useState<PlatformSubTab>("settings");
  const [busy, setBusy] = useState(false);
  const [executableExists, setExecutableExists] = useState(true);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [romsNonce, setRomsNonce] = useState(0);
  const [cloudNonce, setCloudNonce] = useState(0);

  // Every served system shares ONE install, so the executable/version/status
  // come from whichever served system currently has them.
  const primaryConfig = useMemo(() => {
    const configured = emulator.systems
      .map((s) => configs[s])
      .find((c) => c.executablePath);
    return configured ?? configs[emulator.systems[0]];
  }, [configs, emulator.systems]);

  const activeConfig = configs[activePlatform];
  const isConfigured = primaryConfig.executablePath !== null;
  const supportsMemoryCards =
    activePlatform === "ps1" || activePlatform === "ps2";

  const formatLastScan = (ts: number | null): string =>
    ts !== null ? formatRelativeShort(ts, i18n.language) : "—";

  useEffect(() => {
    // Reset an unavailable sub-tab when switching platforms.
    if (subTab === "memory-cards" && !supportsMemoryCards)
      setSubTab("settings");
    if ((subTab === "settings" || subTab === "controls") && !isConfigured)
      setSubTab("rom-folders");
  }, [activePlatform, supportsMemoryCards, isConfigured, subTab]);

  useEffect(() => {
    let cancelled = false;
    if (!primaryConfig.executablePath) {
      setExecutableExists(false);
      return;
    }
    window.electron
      .checkEmulatorExecutable(primaryConfig.system)
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryConfig.system, primaryConfig.executablePath]);

  // Executable/detect/remove are emulator-wide: apply to EVERY served system so
  // the one install stays consistent across all its platforms.
  const applyToAllSystems = useCallback(
    async (
      fn: (system: EmulatorSystem) => Promise<EmulatorConfigMap[EmulatorSystem]>
    ) => {
      const next = { ...configs };
      for (const system of emulator.systems) {
        next[system] = await fn(system);
      }
      onChange(next);
    },
    [configs, emulator.systems, onChange]
  );

  const handleRedetect = useCallback(async () => {
    setBusy(true);
    try {
      await applyToAllSystems((s) => window.electron.detectEmulator(s));
      showSuccessToast(t("redetect_unchanged"));
    } finally {
      setBusy(false);
    }
  }, [applyToAllSystems, showSuccessToast, t]);

  const handleBrowseExecutable = useCallback(async () => {
    const isMac = window.electron.platform === "darwin";
    const result = await window.electron.showOpenDialog({
      properties: isMac ? ["openFile", "openDirectory"] : ["openFile"],
      defaultPath: primaryConfig.executablePath ?? undefined,
      filters:
        window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : isMac
            ? [{ name: "Application", extensions: ["app"] }]
            : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setBusy(true);
    try {
      const preview = await window.electron.previewEmulatorExecutable(
        primaryConfig.system,
        result.filePaths[0]
      );
      if (!preview) {
        showErrorToast(t("emulator_invalid_executable"));
        return;
      }
      await applyToAllSystems((s) =>
        window.electron.setEmulatorExecutablePath(s, result.filePaths[0])
      );
    } finally {
      setBusy(false);
    }
  }, [primaryConfig, applyToAllSystems, showErrorToast, t]);

  const handleRemoveEmulator = useCallback(async () => {
    setBusy(true);
    try {
      await applyToAllSystems((s) => window.electron.removeEmulator(s));
      setRemoveOpen(false);
      onBack();
    } finally {
      setBusy(false);
    }
  }, [applyToAllSystems, onBack]);

  const handleAddFolder = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const folderPath = result.filePaths[0];
    if (activeConfig.romFolders.some((f) => f.path === folderPath)) {
      showErrorToast(t("folder_already_added"));
      return;
    }
    await start(activePlatform, [{ path: folderPath, scanSubfolders: true }], {
      openModal: true,
    });
  }, [activeConfig.romFolders, activePlatform, start, showErrorToast, t]);

  const handleToggleSubfolders = useCallback(
    async (folder: RomFolder) => {
      setBusy(true);
      try {
        const next = await window.electron.toggleRomFolderSubfolders(
          activePlatform,
          folder.id,
          !folder.scanSubfolders
        );
        onChange({ ...configs, [activePlatform]: next });
      } finally {
        setBusy(false);
      }
    },
    [activePlatform, configs, onChange]
  );

  const handleConfirmRemoveFolder = useCallback(async () => {
    if (!folderToRemove) return;
    setBusy(true);
    try {
      const next = await window.electron.removeRomFolder(
        activePlatform,
        folderToRemove.id
      );
      onChange({ ...configs, [activePlatform]: next });
    } finally {
      setBusy(false);
      setFolderToRemove(null);
    }
  }, [activePlatform, configs, folderToRemove, onChange]);

  const handleRescan = useCallback(() => {
    if (activeConfig.romFolders.length === 0) {
      showErrorToast(t("no_rom_folder"));
      return;
    }
    void start(
      activePlatform,
      activeConfig.romFolders.map((f) => ({
        path: f.path,
        scanSubfolders: f.scanSubfolders,
      })),
      { openModal: true }
    );
  }, [activeConfig.romFolders, activePlatform, start, showErrorToast, t]);

  const lastScanNonceRef = useRef(scan.completedNonce);
  useEffect(() => {
    if (scan.completedNonce === lastScanNonceRef.current) return;
    lastScanNonceRef.current = scan.completedNonce;
    void refresh().then(onChange);
    setRomsNonce((n) => n + 1);
  }, [scan.completedNonce, refresh, onChange]);

  const platformLabel = PLATFORM_LABELS[activePlatform];

  const subTabs: { id: PlatformSubTab; label: string }[] = [
    ...(isConfigured
      ? [
          {
            id: "settings" as const,
            label: t("tab_settings", { defaultValue: "Settings" }),
          },
          {
            id: "controls" as const,
            label: t("tab_controls", { defaultValue: "Controls" }),
          },
        ]
      : []),
    { id: "rom-folders", label: t("tab_rom_folders") },
    ...(supportsMemoryCards
      ? [{ id: "memory-cards" as const, label: t("tab_memory_card_backups") }]
      : []),
    { id: "library", label: t("tab_library") },
  ];

  return (
    <div className="emulator-manager">
      <button
        type="button"
        className="emulator-manager__breadcrumb"
        onClick={onBack}
      >
        <ChevronLeftIcon size={12} />
        <span>{t("back_to_emulation", { defaultValue: "All emulators" })}</span>
      </button>

      {/* ── Emulator-wide (general) header ── */}
      <section className="emulator-manager__hero">
        <img
          src={emulator.logo}
          alt={emulator.name}
          className={cn("emulator-manager__hero-logo", {
            "emulator-manager__hero-logo--color": emulator.colorLogo,
          })}
        />
        <div className="emulator-manager__hero-text">
          <h2 className="emulator-manager__hero-title">{emulator.name}</h2>
          <div className="emulator-manager__hero-meta">
            {isConfigured ? (
              executableExists ? (
                <span className="emulator-manager__ok">
                  <CheckCircleFillIcon size={14} /> {t("synced")}
                </span>
              ) : (
                <span className="emulator-manager__warn">
                  <AlertIcon size={14} /> {t("executable_missing")}
                </span>
              )
            ) : (
              <span className="emulator-manager__warn">
                <AlertIcon size={14} /> {t("not_detected")}
              </span>
            )}
            {primaryConfig.detectedVersion && (
              <span className="emulator-manager__version">
                v{primaryConfig.detectedVersion}
              </span>
            )}
            <span className="emulator-manager__platforms-label">
              {emulator.systems.map((s) => PLATFORM_LABELS[s]).join(" · ")}
            </span>
          </div>
        </div>
      </section>

      {/* Emulator executable — shared across every platform. */}
      <section className="emulator-manager__general">
        <header className="emulator-manager__section-header">
          <h3>{t("executable_path_title")}</h3>
          <p>{t("executable_path_description")}</p>
        </header>
        <div className="emulator-manager__exec-row">
          <button
            type="button"
            className="emulator-manager__exec-box"
            onClick={handleBrowseExecutable}
            disabled={busy}
            title={primaryConfig.executablePath ?? undefined}
          >
            <span
              className={cn("emulator-manager__exec-text", {
                "emulator-manager__exec-text--placeholder":
                  !primaryConfig.executablePath,
              })}
            >
              {primaryConfig.executablePath ??
                t("select_executable_placeholder")}
            </span>
          </button>
          {!isConfigured && (
            <Button
              theme="primary"
              onClick={() => setSetupOpen(true)}
              disabled={busy}
            >
              <DownloadIcon size={16} />
              <span>{t("start_setup", { defaultValue: "Set up" })}</span>
            </Button>
          )}
          <Button theme="outline" onClick={handleRedetect} disabled={busy}>
            <SyncIcon size={13} />
            <span>{t("re_detect")}</span>
          </Button>
          <Button
            theme="outline"
            onClick={handleBrowseExecutable}
            disabled={busy}
          >
            <FileDirectoryIcon size={16} />
            <span>{t("browse_files")}</span>
          </Button>
        </div>
        {isConfigured && (
          <button
            type="button"
            className="emulator-manager__remove"
            onClick={() => setRemoveOpen(true)}
            disabled={busy}
          >
            <TrashIcon size={14} />
            <span>{t("remove_emulator")}</span>
          </button>
        )}
      </section>

      {/* ── Per-platform tabs ── */}
      {emulator.systems.length > 1 && (
        <div className="emulator-manager__platform-tabs" role="tablist">
          {emulator.systems.map((system) => (
            <button
              key={system}
              type="button"
              role="tab"
              aria-selected={activePlatform === system}
              className={cn("emulator-manager__platform-tab", {
                "emulator-manager__platform-tab--active":
                  activePlatform === system,
              })}
              onClick={() => setActivePlatform(system)}
              title={PLATFORM_LABELS[system]}
            >
              {/* The logos are wordmarks, so no separate text label (PSP has
                  no logo and falls back to its name). */}
              <PlatformLogo
                system={system}
                className="emulator-manager__platform-tab-logo"
              />
            </button>
          ))}
        </div>
      )}

      {/* Per-platform sub-tabs */}
      <div className="emulator-manager__subtabs" role="tablist">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            className={cn("emulator-manager__subtab", {
              "emulator-manager__subtab--active": subTab === tab.id,
            })}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="emulator-manager__panel">
        {subTab === "settings" && (
          <EmulatorSettingsSection system={activePlatform} />
        )}

        {subTab === "controls" && (
          <ControllerMappingSection binary={emulator.binary} />
        )}

        {subTab === "rom-folders" && (
          <section className="emulator-manager__section">
            <header className="emulator-manager__section-header emulator-manager__section-header--row">
              <div>
                <h3>{t("rom_folders_section_title")}</h3>
                <p>{t("rom_folders_section_description")}</p>
              </div>
              <Button
                theme="outline"
                onClick={handleAddFolder}
                disabled={busy || scan.active}
              >
                <PlusIcon size={14} />
                <span>{t("add_folder")}</span>
              </Button>
            </header>
            <div className="emulator-manager__folders">
              {activeConfig.romFolders.length === 0 && (
                <p className="emulator-manager__empty">{t("no_rom_folder")}</p>
              )}
              {activeConfig.romFolders.map((folder) => (
                <div className="emulator-manager__folder-row" key={folder.id}>
                  <FileDirectoryIcon size={22} />
                  <div className="emulator-manager__folder-info">
                    <span className="emulator-manager__folder-path">
                      {folder.path}
                    </span>
                    <span className="emulator-manager__folder-meta">
                      {t(
                        folder.fileCount === 1
                          ? "file_count_one"
                          : "file_count_other",
                        { count: folder.fileCount }
                      )}
                    </span>
                  </div>
                  <CheckboxField
                    label={t("scan_subfolders")}
                    checked={folder.scanSubfolders}
                    disabled={busy}
                    onChange={() => handleToggleSubfolders(folder)}
                  />
                  <button
                    type="button"
                    className="emulator-manager__folder-remove"
                    onClick={() => setFolderToRemove(folder)}
                    aria-label={t("remove")}
                    disabled={busy}
                  >
                    <XIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {subTab === "memory-cards" && supportsMemoryCards && (
          <>
            <MemoryCardsSection
              config={activeConfig}
              onUploaded={() => setCloudNonce((n) => n + 1)}
            />
            <CloudSavesSection config={activeConfig} refreshKey={cloudNonce} />
          </>
        )}

        {subTab === "library" && (
          <section className="emulator-manager__section">
            <header className="emulator-manager__section-header emulator-manager__section-header--row">
              <div>
                <h3>{t("library_section_title")}</h3>
                <p>
                  {t("library_section_description", { system: platformLabel })}
                </p>
              </div>
              <Button
                theme="outline"
                onClick={handleRescan}
                disabled={busy || scan.active}
              >
                <SyncIcon size={13} />
                <span>{t("rescan")}</span>
              </Button>
            </header>
            <ClassicsScanIndicator variant="section" />
            <p className="emulator-manager__lib-stat">
              {t("games_found_other", { count: activeConfig.totalFiles })} ·{" "}
              {t("stat_last_scan")}: {formatLastScan(activeConfig.lastScanAt)}
            </p>
            <RomsDetectedSection
              system={activePlatform}
              systemLabel={platformLabel}
              onRescan={handleRescan}
              disabled={busy || scan.active}
              refreshKey={romsNonce}
            />
          </section>
        )}
      </div>

      <ConfirmationModal
        visible={folderToRemove !== null}
        title={t("remove_rom_folder_title")}
        descriptionText={t("remove_rom_folder_description", {
          path: folderToRemove?.path ?? "",
        })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleConfirmRemoveFolder}
        onClose={() => setFolderToRemove(null)}
        buttonsIsDisabled={busy}
      />
      <ConfirmationModal
        visible={removeOpen}
        title={t("remove_emulator_title", { name: emulator.name })}
        descriptionText={t("remove_emulator_description", {
          name: emulator.name,
        })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleRemoveEmulator}
        onClose={() => setRemoveOpen(false)}
        buttonsIsDisabled={busy}
      />

      <EmulatorSetupModal
        visible={setupOpen}
        system={emulator.systems[0]}
        systemLabel={emulator.name}
        initialConfig={primaryConfig}
        onClose={async () => {
          setSetupOpen(false);
          onChange(await refresh());
        }}
        onComplete={async () => {
          setSetupOpen(false);
          onChange(await refresh());
        }}
      />
    </div>
  );
}
