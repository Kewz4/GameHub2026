import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GameControllerIcon,
  HardDrivesIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import type {
  EmulatorBinary,
  EmulatorConfig,
  EmulatorConfigMap,
  EmulatorSystem,
  RomFolder,
} from "@types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Checkbox,
  FileExplorerModal,
  FocusItem,
  GridFocusGroup,
  HorizontalFocusGroup,
  Input,
  VerticalFocusGroup,
} from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
import {
  useBigPictureToast,
  useNavigationActions,
  useNavigationScreenActions,
  useUserPreferences,
} from "../../../hooks";
import {
  EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_REDETECT_BUTTON_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
  EMULATION_DETAIL_RESCAN_BUTTON_ID,
  EMULATION_OVERVIEW_CARD_FOCUS_IDS,
  EMULATION_OVERVIEW_REGION_ID,
  getEmulationRomFolderRemoveFocusId,
  getEmulationRomFolderToggleFocusId,
} from "../settings-navigation";
import { CloudSavesSection } from "./cloud-saves-section";
import { ControllerMapperModal } from "./controller/controller-mapper-modal";
import { EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS } from "./emulation-detail-navigation";
import {
  BIG_PICTURE_EMULATOR_SYSTEM_LABELS,
  BIG_PICTURE_EMULATOR_SYSTEMS,
  getBigPictureEmulatorCardAction,
  getBigPictureEmulatorInstallSystems,
  getBigPictureEmulatorRuntimeStatus,
  isBigPictureEmulatorConfigured,
  supportsBigPictureMemoryCards,
} from "./emulation-parity";
import { BigPictureEmulatorSettingsSection } from "./emulator-settings-section";
import { BigPictureEmulatorRomsSection } from "./emulator-roms-section";
import { MemoryCardsSection } from "./memory-cards-section";
import { formatBytes } from "./shared";
import { EmulatorSetupModal } from "./setup/emulator-setup-modal";

import "./styles.scss";

const BINARY_LABELS: Record<EmulatorBinary, string> = {
  duckstation: "DuckStation",
  pcsx2: "PCSX2",
  rpcs3: "RPCS3",
  ppsspp: "PPSSPP",
  azahar: "Azahar",
  ralibretro: "RALibretro",
  raproject64: "RAProject64",
  ravba: "RAVBA",
  cemu: "Cemu",
  dolphin: "Dolphin",
  eden: "Eden",
};

const RA_USERNAME_FOCUS_ID = "emulation-ra-username";
const RA_APIKEY_FOCUS_ID = "emulation-ra-apikey";
const RA_SAVE_FOCUS_ID = "emulation-ra-save";
const EMULATION_DETAIL_CONTROLLER_BUTTON_ID =
  "emulation-detail-controller-button";
const EMULATION_DETAIL_SETUP_BUTTON_ID = "emulation-detail-setup-button";

type DetailPicker = "executable" | "rom-folder" | null;

interface EmulationDetailProps {
  config: EmulatorConfig;
  executableExists: boolean | null;
  installSystems: EmulatorSystem[];
  onBack: () => void;
  onChange: (config: EmulatorConfig) => void;
  onOpenController: (target: { binary: EmulatorBinary; label: string }) => void;
  onOpenSetup: (system: EmulatorSystem) => void;
}

function formatLastScan(timestamp: number | null) {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function pathsEqual(left: string, right: string) {
  return globalThis.window.electron.platform === "win32"
    ? left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0
    : left === right;
}

function EmulationDetail({
  config,
  executableExists,
  installSystems,
  onBack,
  onChange,
  onOpenController,
  onOpenSetup,
}: Readonly<EmulationDetailProps>) {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigationActions();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [picker, setPicker] = useState<DetailPicker>(null);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [removeEmulatorOpen, setRemoveEmulatorOpen] = useState(false);
  const [cloudRefreshKey, setCloudRefreshKey] = useState(0);
  const systemLabel = BIG_PICTURE_EMULATOR_SYSTEM_LABELS[config.system];
  const binaryLabel = BINARY_LABELS[config.binary];
  const supportsMemoryCards = supportsBigPictureMemoryCards(config.system);
  const configured = isBigPictureEmulatorConfigured(config);
  const runtimeStatus = getBigPictureEmulatorRuntimeStatus(
    config,
    executableExists
  );

  useNavigationScreenActions({
    press: {
      b: onBack,
    },
  });

  useLayoutEffect(() => {
    // The overview may be scrolled to a later console card. A detail view is a
    // fresh controller surface, so reset before focusing its breadcrumb; this
    // keeps that first action below the sticky Settings category rail.
    const settingsPage = globalThis.document.querySelector(".settings-page");
    if (settingsPage instanceof HTMLElement) {
      settingsPage.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(EMULATION_DETAIL_BACK_BUTTON_ID);
    });
    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [setFocus]);

  const runAction = useCallback(
    async (
      name: string,
      action: () => Promise<EmulatorConfig>,
      successMessage?: string
    ) => {
      setBusyAction(name);
      try {
        const next = await action();
        onChange(next);
        if (successMessage) showSuccessToast(successMessage);
        return next;
      } catch {
        showErrorToast("Emulator settings could not be updated");
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [onChange, showErrorToast, showSuccessToast]
  );

  const runInstallAction = useCallback(
    async (
      name: string,
      action: (system: EmulatorSystem) => Promise<EmulatorConfig>,
      successMessage?: string
    ) => {
      setBusyAction(name);
      try {
        let activeConfig: EmulatorConfig | null = null;
        for (const system of installSystems) {
          const next = await action(system);
          onChange(next);
          if (system === config.system) activeConfig = next;
        }
        if (successMessage) showSuccessToast(successMessage);
        return activeConfig;
      } catch {
        showErrorToast("Emulator settings could not be updated");
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [config.system, installSystems, onChange, showErrorToast, showSuccessToast]
  );

  const handleExecutableSelected = useCallback(
    async (path: string) => {
      setPicker(null);
      try {
        const preview =
          await globalThis.window.electron.previewEmulatorExecutable(
            config.system,
            path
          );
        if (!preview) {
          showErrorToast("That file is not a compatible emulator executable");
          return;
        }

        await runInstallAction(
          "executable",
          (system) =>
            globalThis.window.electron.setEmulatorExecutablePath(
              system,
              preview.executablePath
            ),
          `${binaryLabel} executable updated`
        );
      } catch {
        showErrorToast("The emulator executable could not be updated");
      }
    },
    [binaryLabel, config.system, runInstallAction, showErrorToast]
  );

  const handleRomFolderSelected = useCallback(
    async (path: string) => {
      setPicker(null);
      if (config.romFolders.some((folder) => pathsEqual(folder.path, path))) {
        showErrorToast("That ROM folder is already tracked");
        return;
      }

      setBusyAction("add-folder");
      try {
        await globalThis.window.electron.addRomFolder(
          config.system,
          path,
          true
        );
        const next = await globalThis.window.electron.rescanEmulator(
          config.system
        );
        onChange(next);
        showSuccessToast(
          `ROM folder added · ${next.totalFiles} game${next.totalFiles === 1 ? "" : "s"} found`
        );
      } catch {
        showErrorToast("The ROM folder could not be scanned");
      } finally {
        setBusyAction(null);
      }
    },
    [
      config.romFolders,
      config.system,
      onChange,
      showErrorToast,
      showSuccessToast,
    ]
  );

  const handleRemoveFolder = useCallback(async () => {
    if (!folderToRemove) return;
    const folder = folderToRemove;
    setFolderToRemove(null);
    await runAction(
      "remove-folder",
      () =>
        globalThis.window.electron.removeRomFolder(config.system, folder.id),
      "ROM folder removed"
    );
  }, [config.system, folderToRemove, runAction]);

  const handleRemoveEmulator = useCallback(async () => {
    setRemoveEmulatorOpen(false);
    const next = await runInstallAction("remove-emulator", (system) =>
      globalThis.window.electron.removeEmulator(system)
    );
    if (next) onBack();
  }, [onBack, runInstallAction]);

  const isBusy = busyAction !== null;
  const firstFolder = config.romFolders[0];

  return (
    <VerticalFocusGroup regionId={EMULATION_DETAIL_REGION_ID} asChild>
      <div className="emulator-detail">
        <FocusItem
          id={EMULATION_DETAIL_BACK_BUTTON_ID}
          actions={{ primary: onBack }}
          asChild
        >
          <button
            type="button"
            className="emulator-detail__breadcrumb"
            onClick={onBack}
          >
            <ArrowLeftIcon size={16} />
            <span>{t("back_to_emulation", "All emulators")}</span>
          </button>
        </FocusItem>

        <section className="emulator-detail__hero">
          <div className="emulator-detail__hero-text">
            <h2 className="emulator-detail__hero-title">{systemLabel}</h2>
            <div className="emulator-detail__hero-meta">
              {runtimeStatus === "ready" || runtimeStatus === "checking" ? (
                <span className="emulator-detail__synced">
                  <CheckCircleIcon size={15} weight="fill" />
                  {runtimeStatus === "checking"
                    ? `Checking ${binaryLabel}…`
                    : `${binaryLabel} configured`}
                </span>
              ) : (
                <span className="emulator-detail__path-missing">
                  <WarningIcon size={15} weight="fill" />
                  {runtimeStatus === "missing"
                    ? "Executable is missing"
                    : "Emulator needs attention"}
                </span>
              )}
              {config.detectedVersion ? (
                <span className="emulator-detail__hero-version">
                  v{config.detectedVersion}
                </span>
              ) : null}
              <span className="emulator-detail__hero-count">
                <span className="emulator-detail__hero-count-dot" />
                {config.totalFiles} game{config.totalFiles === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          <HorizontalFocusGroup className="emulator-detail__hero-actions">
            <Button
              focusId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
              icon={<MagnifyingGlassIcon size={18} />}
              loading={busyAction === "rescan"}
              disabled={config.romFolders.length === 0 || isBusy}
              onClick={() => {
                void runAction(
                  "rescan",
                  () =>
                    globalThis.window.electron.rescanEmulator(config.system),
                  "ROM library scan complete"
                );
              }}
            >
              Rescan games
            </Button>
            <Button
              focusId={EMULATION_DETAIL_CONTROLLER_BUTTON_ID}
              variant="secondary"
              icon={<GameControllerIcon size={18} />}
              disabled={isBusy}
              onClick={() =>
                onOpenController({
                  binary: config.binary,
                  label: systemLabel,
                })
              }
            >
              Controller mapping
            </Button>
            <Button
              focusId={EMULATION_DETAIL_SETUP_BUTTON_ID}
              variant="secondary"
              icon={<WrenchIcon size={18} />}
              disabled={isBusy}
              onClick={() => onOpenSetup(config.system)}
            >
              Setup assistant
            </Button>
          </HorizontalFocusGroup>
        </section>

        <section className="emulator-detail__section">
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>Emulator executable</h3>
              <p>Change or re-detect the executable used to launch games.</p>
            </div>
          </header>

          <div className="emulator-detail__row emulator-detail__exec-row">
            <HardDrivesIcon size={28} />
            <div className="emulator-detail__exec-info">
              <span className="emulator-detail__exec-name">{binaryLabel}</span>
              <span className="emulator-detail__exec-path">
                {config.executablePath ?? "No executable selected"}
              </span>
            </div>
            <HorizontalFocusGroup className="emulator-detail__exec-actions">
              <Button
                focusId={EMULATION_DETAIL_EXECUTABLE_BUTTON_ID}
                variant="secondary"
                icon={<FolderOpenIcon size={17} />}
                disabled={isBusy}
                onClick={() => setPicker("executable")}
              >
                Browse
              </Button>
              <Button
                focusId={EMULATION_DETAIL_REDETECT_BUTTON_ID}
                variant="secondary"
                loading={busyAction === "redetect"}
                disabled={isBusy}
                onClick={() => {
                  void runInstallAction(
                    "redetect",
                    (system) =>
                      globalThis.window.electron.detectEmulator(system),
                    `${binaryLabel} detection refreshed`
                  );
                }}
              >
                Re-detect
              </Button>
              <Button
                focusId={EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID}
                variant="danger"
                icon={<TrashIcon size={17} />}
                disabled={!configured || isBusy}
                onClick={() => setRemoveEmulatorOpen(true)}
              >
                Remove
              </Button>
            </HorizontalFocusGroup>
          </div>
        </section>

        <section className="emulator-detail__section">
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>Performance and video</h3>
              <p>
                Controller-friendly settings written directly to the emulator.
              </p>
            </div>
          </header>
          <BigPictureEmulatorSettingsSection system={config.system} />
        </section>

        <section className="emulator-detail__section">
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>ROM folders</h3>
              <p>Add, scan, and remove the folders used for this console.</p>
            </div>
            <Button
              focusId={EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID}
              variant="secondary"
              icon={<FolderPlusIcon size={18} />}
              loading={busyAction === "add-folder"}
              disabled={isBusy}
              onClick={() => setPicker("rom-folder")}
            >
              Add folder
            </Button>
          </header>

          <VerticalFocusGroup className="emulator-detail__folders">
            {config.romFolders.length === 0 ? (
              <p className="emulator-detail__empty" role="status">
                No ROM folders are tracked yet.
              </p>
            ) : null}

            {config.romFolders.map((folder) => (
              <div className="emulator-detail__row" key={folder.id}>
                <FolderOpenIcon size={24} />
                <div className="emulator-detail__folder-info">
                  <span className="emulator-detail__folder-path">
                    {folder.path}
                  </span>
                  <span className="emulator-detail__folder-meta">
                    {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
                    <span className="emulator-detail__dot" />
                    Last scan {formatLastScan(folder.lastScanAt)}
                  </span>
                </div>
                <Checkbox
                  focusId={getEmulationRomFolderToggleFocusId(folder.id)}
                  label="Subfolders"
                  checked={folder.scanSubfolders}
                  disabled={isBusy}
                  onChange={() => {
                    void runAction("toggle-folder", () =>
                      globalThis.window.electron.toggleRomFolderSubfolders(
                        config.system,
                        folder.id,
                        !folder.scanSubfolders
                      )
                    );
                  }}
                />
                <Button
                  focusId={getEmulationRomFolderRemoveFocusId(folder.id)}
                  size="icon"
                  variant="danger"
                  aria-label={`Remove ${folder.path}`}
                  disabled={isBusy}
                  onClick={() => setFolderToRemove(folder)}
                >
                  <TrashIcon size={18} />
                </Button>
              </div>
            ))}
          </VerticalFocusGroup>
        </section>

        <section className="emulator-detail__section">
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>Library status</h3>
              <p>Current import coverage for {systemLabel}.</p>
            </div>
          </header>
          <div className="emulator-detail__stats">
            <div className="emulator-detail__stat">
              <span className="emulator-detail__stat-label">Games</span>
              <span className="emulator-detail__stat-value">
                {config.totalFiles}
              </span>
              <span className="emulator-detail__stat-caption">
                Matched files in your library
              </span>
            </div>
            <div className="emulator-detail__stat">
              <span className="emulator-detail__stat-label">Storage</span>
              <span className="emulator-detail__stat-value">
                {formatBytes(config.totalSizeBytes)}
              </span>
              <span className="emulator-detail__stat-caption">
                Across {config.romFolders.length} folder
                {config.romFolders.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="emulator-detail__stat">
              <span className="emulator-detail__stat-label">Last scan</span>
              <span className="emulator-detail__stat-value emulator-detail__stat-value--date">
                {formatLastScan(config.lastScanAt)}
              </span>
              <span className="emulator-detail__stat-caption">
                Scan again after adding or moving games
              </span>
            </div>
          </div>
        </section>

        <BigPictureEmulatorRomsSection
          system={config.system}
          systemLabel={systemLabel}
          refreshKey={config.lastScanAt}
        />

        {supportsMemoryCards ? (
          <>
            <MemoryCardsSection
              config={config}
              upTargetId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
              downTargetId={
                EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS.memoryCardsDown
              }
              onUploaded={() => setCloudRefreshKey((key) => key + 1)}
            />
            <CloudSavesSection
              config={config}
              refreshKey={cloudRefreshKey}
              upTargetId={EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS.cloudSavesUp}
            />
          </>
        ) : null}

        <FileExplorerModal
          visible={picker === "executable"}
          title={`Select ${binaryLabel} executable`}
          initialPath={config.executablePath ?? undefined}
          filters={
            globalThis.window.electron.platform === "win32"
              ? [
                  {
                    name: "Executable",
                    extensions: ["exe", "bat", "cmd", "com"],
                  },
                ]
              : undefined
          }
          selectDirectory={globalThis.window.electron.platform === "darwin"}
          onClose={() => setPicker(null)}
          onSelect={(path) => {
            void handleExecutableSelected(path);
          }}
        />

        <FileExplorerModal
          visible={picker === "rom-folder"}
          title={`Add ${systemLabel} ROM folder`}
          initialPath={firstFolder?.path}
          selectDirectory
          onClose={() => setPicker(null)}
          onSelect={(path) => {
            void handleRomFolderSelected(path);
          }}
        />

        <ConfirmationModal
          visible={folderToRemove !== null}
          title="Remove ROM folder?"
          description={`GameHub will stop scanning ${folderToRemove?.path ?? "this folder"}. Existing library entries are not deleted.`}
          confirmLabel="Remove folder"
          danger
          loading={busyAction === "remove-folder"}
          onClose={() => setFolderToRemove(null)}
          onConfirm={handleRemoveFolder}
        />

        <ConfirmationModal
          visible={removeEmulatorOpen}
          title={`Remove ${binaryLabel}?`}
          description="This clears the configured executable. ROM files and saves stay on disk."
          confirmLabel="Remove emulator"
          danger
          loading={busyAction === "remove-emulator"}
          onClose={() => setRemoveEmulatorOpen(false)}
          onConfirm={handleRemoveEmulator}
        />
      </div>
    </VerticalFocusGroup>
  );
}

interface ConsoleOverviewCardProps {
  system: EmulatorSystem;
  config: EmulatorConfig;
  executableExists: boolean | null;
  focusId: string;
  onSelect: () => void;
}

function ConsoleOverviewCard({
  system,
  config,
  executableExists,
  focusId,
  onSelect,
}: Readonly<ConsoleOverviewCardProps>) {
  const configured = isBigPictureEmulatorConfigured(config);
  const runtimeStatus = getBigPictureEmulatorRuntimeStatus(
    config,
    executableExists
  );
  const ready = runtimeStatus === "ready" || runtimeStatus === "checking";
  const binaryLabel = BINARY_LABELS[config.binary];

  return (
    <FocusItem id={focusId} actions={{ primary: onSelect }} asChild>
      <button
        className={`console-card ${ready ? "" : "console-card--unconfigured"}`}
        onClick={onSelect}
        type="button"
      >
        <span className="console-card__heading">
          <span className="console-card__title">
            {BIG_PICTURE_EMULATOR_SYSTEM_LABELS[system]}
          </span>
          <span className="console-card__subline">
            <span className="console-card__emulator">{binaryLabel}</span>
            {config.detectedVersion ? (
              <>
                <span className="console-card__dot" />
                <span className="console-card__version">
                  {config.detectedVersion}
                </span>
              </>
            ) : null}
          </span>
        </span>

        <span className="console-card__body">
          {ready ? (
            <span className="console-card__stats">
              <span className="console-card__stat-row">
                <span className="console-card__stat-dot" />
                <strong className="console-card__stat-number">
                  {config.totalFiles}
                </strong>
                <span className="console-card__stat-label">
                  game{config.totalFiles === 1 ? "" : "s"}
                </span>
              </span>
              <span className="console-card__last-scan">
                Last scan: {formatLastScan(config.lastScanAt)}
              </span>
            </span>
          ) : (
            <span className="console-card__hint-box">
              <span className="console-card__hint-title">
                <WarningIcon size={16} weight="fill" />
                {runtimeStatus === "missing"
                  ? "Executable missing"
                  : "Setup required"}
              </span>
              <span className="console-card__hint-text">
                {runtimeStatus === "missing"
                  ? `Locate ${binaryLabel} again; your ROM folders and saves are unchanged.`
                  : `Install or locate ${binaryLabel}, then import your ROM folder.`}
              </span>
            </span>
          )}
        </span>

        <span className="console-card__footer">
          <span
            className={`console-card__chip ${
              ready ? "console-card__chip--ready" : "console-card__chip--warn"
            }`}
          >
            <span className="console-card__chip-dot" />
            {ready
              ? runtimeStatus === "checking"
                ? "Checking"
                : "Ready"
              : runtimeStatus === "missing"
                ? "Path missing"
                : "Not configured"}
          </span>
          <span className="console-card__cta">
            {configured ? "Manage" : "Set up"}
          </span>
        </span>
      </button>
    </FocusItem>
  );
}

function RetroAchievementsBpSection() {
  const userPreferences = useUserPreferences();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!userPreferences) return;
    setUsername(userPreferences.retroAchievementsUsername ?? "");
    setApiKey(userPreferences.retroAchievementsApiKey ?? "");
  }, [userPreferences]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await globalThis.window.electron.updateUserPreferences({
        retroAchievementsUsername: username.trim() || undefined,
        retroAchievementsApiKey: apiKey.trim() || undefined,
      });
      showSuccessToast("RetroAchievements credentials saved");
    } catch {
      showErrorToast("RetroAchievements credentials could not be saved");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <VerticalFocusGroup regionId="emulation-retroachievements-region" asChild>
      <section className="emulation-settings__retroachievements">
        <h2 className="emulation-settings__title">RetroAchievements</h2>
        <p className="emulation-settings__description">
          Connect your account so supported emulators can report unlocks while
          you play.
        </p>
        <Input
          label="Username"
          value={username}
          placeholder="RetroAchievements username"
          focusId={RA_USERNAME_FOCUS_ID}
          autoComplete="off"
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          label="Web API key"
          type="password"
          value={apiKey}
          placeholder="Web API key"
          focusId={RA_APIKEY_FOCUS_ID}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <Button
          focusId={RA_SAVE_FOCUS_ID}
          onClick={() => {
            void handleSave();
          }}
          loading={isSaving}
          disabled={!username.trim() || !apiKey.trim()}
        >
          Save
        </Button>
      </section>
    </VerticalFocusGroup>
  );
}

export function EmulationSettingsSection() {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigationActions();
  const { showErrorToast } = useBigPictureToast();
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [executableExistsBySystem, setExecutableExistsBySystem] = useState<
    Partial<Record<EmulatorSystem, boolean>>
  >({});
  const [loadingError, setLoadingError] = useState(false);
  const [activeSystem, setActiveSystem] = useState<EmulatorSystem | null>(null);
  const [setupSystem, setSetupSystem] = useState<EmulatorSystem | null>(null);
  const [controllerTarget, setControllerTarget] = useState<{
    binary: EmulatorBinary;
    label: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await globalThis.window.electron.getEmulatorConfigs();
      setConfigs(next);
      setLoadingError(false);
      return next;
    } catch {
      setLoadingError(true);
      showErrorToast("Emulator configuration could not be loaded");
      return null;
    }
  }, [showErrorToast]);

  useEffect(() => {
    let cancelled = false;
    globalThis.window.electron
      .getEmulatorConfigs()
      .then((next) => {
        if (!cancelled) setConfigs(next);
      })
      .catch(() => {
        if (!cancelled) setLoadingError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configs) return;
    let cancelled = false;
    setExecutableExistsBySystem({});

    void Promise.all(
      BIG_PICTURE_EMULATOR_SYSTEMS.map(async (system) => {
        if (!isBigPictureEmulatorConfigured(configs[system])) {
          return [system, false] as const;
        }
        const result = await globalThis.window.electron
          .checkEmulatorExecutable(system)
          .catch(() => ({ exists: false }));
        return [system, result.exists] as const;
      })
    ).then((entries) => {
      if (!cancelled) setExecutableExistsBySystem(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [configs]);

  useEffect(() => {
    if (activeSystem) return;
    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps1);
    });
    return () => globalThis.window.cancelAnimationFrame(frameId);
  }, [activeSystem, setFocus]);

  const cardItems = useMemo(() => {
    if (!configs) return [];
    return BIG_PICTURE_EMULATOR_SYSTEMS.map((system) => ({
      system,
      config: configs[system],
      focusId: EMULATION_OVERVIEW_CARD_FOCUS_IDS[system],
    }));
  }, [configs]);

  const configuredEmulators = useMemo(() => {
    if (!configs) return [];
    const seen = new Set<EmulatorBinary>();
    const result: { binary: EmulatorBinary; label: string }[] = [];

    for (const system of BIG_PICTURE_EMULATOR_SYSTEMS) {
      const config = configs[system];
      if (!isBigPictureEmulatorConfigured(config) || seen.has(config.binary)) {
        continue;
      }
      seen.add(config.binary);
      result.push({
        binary: config.binary,
        label: BINARY_LABELS[config.binary],
      });
    }
    return result;
  }, [configs]);

  const handleSelectSystem = useCallback(
    (system: EmulatorSystem) => {
      const config = configs?.[system];
      if (getBigPictureEmulatorCardAction(config) === "manage") {
        setActiveSystem(system);
      } else {
        setSetupSystem(system);
      }
    },
    [configs]
  );

  const handleSetupClosed = useCallback(async () => {
    setSetupSystem(null);
    await refresh();
  }, [refresh]);

  if (activeSystem && configs) {
    return (
      <>
        <EmulationDetail
          config={configs[activeSystem]}
          executableExists={executableExistsBySystem[activeSystem] ?? null}
          installSystems={getBigPictureEmulatorInstallSystems(
            configs,
            activeSystem
          )}
          onBack={() => {
            setActiveSystem(null);
            void refresh();
          }}
          onChange={(next) =>
            setConfigs((current) =>
              current ? { ...current, [next.system]: next } : current
            )
          }
          onOpenController={setControllerTarget}
          onOpenSetup={setSetupSystem}
        />
        <ControllerMapperModal
          visible={controllerTarget !== null}
          binary={controllerTarget?.binary ?? "ralibretro"}
          emulatorLabel={controllerTarget?.label ?? ""}
          onClose={() => setControllerTarget(null)}
        />
        <EmulatorSetupModal
          visible={setupSystem !== null}
          system={setupSystem}
          installSystems={
            setupSystem
              ? getBigPictureEmulatorInstallSystems(configs, setupSystem)
              : []
          }
          systemLabel={
            setupSystem ? BIG_PICTURE_EMULATOR_SYSTEM_LABELS[setupSystem] : ""
          }
          initialConfig={setupSystem ? configs[setupSystem] : null}
          onClose={handleSetupClosed}
          onComplete={handleSetupClosed}
        />
      </>
    );
  }

  if (!configs) {
    return (
      <div
        className="settings-emulation__loading"
        role={loadingError ? "alert" : "status"}
      >
        <span>
          {loadingError
            ? "Emulator configuration could not be loaded."
            : t("loading", "Loading emulators…")}
        </span>
        {loadingError ? (
          <Button
            icon={<ArrowClockwiseIcon size={18} />}
            onClick={() => {
              void refresh();
            }}
          >
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="settings-emulation">
      <header className="emulation-settings__header">
        <h2 className="emulation-settings__title">
          {t("emulation", "Emulation")}
        </h2>
        <p className="emulation-settings__description">
          Set up every supported emulator, import ROM folders, configure
          controllers, and manage memory-card backups without leaving Big
          Picture.
        </p>
      </header>

      <GridFocusGroup
        regionId={EMULATION_OVERVIEW_REGION_ID}
        className="settings-emulation__cards"
      >
        {cardItems.map(({ system, config, focusId }) => (
          <ConsoleOverviewCard
            key={system}
            system={system}
            config={config}
            executableExists={executableExistsBySystem[system] ?? null}
            focusId={focusId}
            onSelect={() => handleSelectSystem(system)}
          />
        ))}
      </GridFocusGroup>

      <RetroAchievementsBpSection />

      {configuredEmulators.length > 0 ? (
        <section className="emulation-settings__controllers">
          <h2 className="emulation-settings__title">Controllers</h2>
          <p className="emulation-settings__description">
            Configure a dedicated mapping for every installed emulator.
          </p>
          <VerticalFocusGroup regionId="emulation-controllers-region">
            {configuredEmulators.map(({ binary, label }) => (
              <Button
                key={binary}
                focusId={`emulation-controller-${binary}`}
                variant="secondary"
                icon={<GameControllerIcon size={18} />}
                onClick={() => setControllerTarget({ binary, label })}
              >
                {label} controller
              </Button>
            ))}
          </VerticalFocusGroup>
        </section>
      ) : null}

      <ControllerMapperModal
        visible={controllerTarget !== null}
        binary={controllerTarget?.binary ?? "ralibretro"}
        emulatorLabel={controllerTarget?.label ?? ""}
        onClose={() => setControllerTarget(null)}
      />

      <EmulatorSetupModal
        visible={setupSystem !== null}
        system={setupSystem}
        installSystems={
          setupSystem
            ? getBigPictureEmulatorInstallSystems(configs, setupSystem)
            : []
        }
        systemLabel={
          setupSystem ? BIG_PICTURE_EMULATOR_SYSTEM_LABELS[setupSystem] : ""
        }
        initialConfig={setupSystem ? configs[setupSystem] : null}
        onClose={handleSetupClosed}
        onComplete={handleSetupClosed}
      />
    </div>
  );
}
