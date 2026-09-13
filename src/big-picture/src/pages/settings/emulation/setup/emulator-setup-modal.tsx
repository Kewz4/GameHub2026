import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FolderPlusIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import type {
  EmulatorConfig,
  EmulatorSystem,
  ResolvedInstallOption,
} from "@types";
import {
  stepListForSystem,
  type StepKind,
} from "@renderer/pages/settings/emulation/setup/types";

import {
  Button,
  Checkbox,
  FileExplorerModal,
  Modal,
  VerticalFocusGroup,
} from "../../../../components";
import { useBigPictureToast, useNavigation } from "../../../../hooks";
import { useBpRomScan } from "./use-bp-rom-scan";

import "./setup.scss";

interface PendingFolder {
  path: string;
  scanSubfolders: boolean;
  previewCount: number | null;
}

type SetupPicker =
  | { kind: "executable" }
  | { kind: "rom-folder"; replaceIndex: number | null }
  | null;

interface Props {
  visible: boolean;
  system: EmulatorSystem | null;
  installSystems: EmulatorSystem[];
  systemLabel: string;
  initialConfig: EmulatorConfig | null;
  onClose: () => void;
  onComplete: (system: EmulatorSystem) => void;
}

const SETUP_CONTINUE_FOCUS_ID = "emulator-setup-continue";
const SETUP_PRIMARY_FOCUS_ID = "emulator-setup-primary-action";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function EmulatorSetupModal({
  visible,
  system,
  installSystems,
  systemLabel,
  initialConfig,
  onClose,
  onComplete,
}: Readonly<Props>) {
  const { setFocus } = useNavigation();
  const { showErrorToast } = useBigPictureToast();
  const { scan, start, cancel, reset } = useBpRomScan();

  const [config, setConfig] = useState<EmulatorConfig | null>(initialConfig);
  const [stepIndex, setStepIndex] = useState(0);
  const [folders, setFolders] = useState<PendingFolder[]>([]);
  const [firmwareOk, setFirmwareOk] = useState(false);
  const [biosOk, setBiosOk] = useState(false);
  const [keysOk, setKeysOk] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [picker, setPicker] = useState<SetupPicker>(null);

  const autoDetectRef = useRef(false);
  const prefilledRef = useRef(false);
  const scanStartedRef = useRef(false);

  const steps = useMemo<StepKind[]>(
    () => (system ? stepListForSystem(system) : []),
    [system]
  );
  const currentStep = steps[stepIndex];
  const systemShort = system ? system.toUpperCase() : "";

  // Reset all wizard state whenever it (re)opens.
  useEffect(() => {
    if (!visible) return;
    setConfig(initialConfig);
    setStepIndex(0);
    setFolders([]);
    setFirmwareOk(false);
    setBiosOk(false);
    setKeysOk(false);
    setShowInstall(false);
    setPicker(null);
    autoDetectRef.current = false;
    prefilledRef.current = false;
    scanStartedRef.current = false;
    reset();
  }, [visible, initialConfig, reset]);

  // Auto-detect the emulator executable on open (matches desktop order).
  useEffect(() => {
    if (!visible || !system) return;
    if (autoDetectRef.current) return;
    if (initialConfig?.executablePath) return;
    autoDetectRef.current = true;

    let cancelled = false;
    setDetecting(true);
    (async () => {
      try {
        const preview =
          await globalThis.window.electron.previewEmulatorExecutable(system);
        if (cancelled || !preview) return;
        setConfig((curr) => {
          if (!curr || curr.executablePath) return curr;
          return {
            ...curr,
            executablePath: preview.executablePath,
            detectedVersion: preview.detectedVersion,
          };
        });
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, system, initialConfig?.executablePath]);

  const refreshConfig = useCallback(async () => {
    if (!system) return null;
    const all = await globalThis.window.electron.getEmulatorConfigs();
    setConfig(all[system]);
    return all[system];
  }, [system]);

  const goNext = useCallback(() => setStepIndex((i) => i + 1), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  // Preview how many ROMs live in a folder without importing (startRomScan).
  const previewFolder = useCallback(
    async (folderPath: string, scanSubfolders: boolean) => {
      if (!system) return 0;
      const { requestId } = await globalThis.window.electron.startRomScan(
        system,
        folderPath,
        scanSubfolders
      );
      return new Promise<number>((resolve) => {
        const unsub = globalThis.window.electron.onRomScanProgress(
          requestId,
          (payload) => {
            if (payload.type === "done" || payload.type === "cancelled") {
              unsub();
              resolve(payload.fileCount);
            } else if (payload.type === "error") {
              unsub();
              resolve(0);
            }
          }
        );
      });
    },
    [system]
  );

  // Reuse folders GameHub or the emulator already knows about. This keeps the
  // controller-only assistant useful for existing libraries (especially the
  // RPCS3 games.yml directory and DuckStation/PCSX2 game paths) instead of
  // forcing the user to browse to the same folder again.
  useEffect(() => {
    if (!visible || !system || currentStep !== "rom_folder") return;
    if (prefilledRef.current || folders.length > 0) return;
    prefilledRef.current = true;

    let cancelled = false;
    void (async () => {
      let seeds: PendingFolder[] = (config?.romFolders ?? []).map((folder) => ({
        path: folder.path,
        scanSubfolders: folder.scanSubfolders,
        previewCount: null,
      }));

      if (seeds.length === 0 && system === "ps3") {
        const sources = await globalThis.window.electron
          .getRpcs3DefaultSources()
          .catch(() => null);
        if (sources?.gamesDir) {
          seeds = [
            {
              path: sources.gamesDir,
              scanSubfolders: true,
              previewCount: null,
            },
          ];
        }
      } else if (seeds.length === 0 && (system === "ps1" || system === "ps2")) {
        const paths = await globalThis.window.electron
          .getEmulatorRomPaths(system)
          .catch(() => [] as string[]);
        seeds = paths.map((path) => ({
          path,
          scanSubfolders: true,
          previewCount: null,
        }));
      }

      if (cancelled || seeds.length === 0) return;
      setFolders(seeds);

      for (const seed of seeds) {
        const count = await previewFolder(seed.path, seed.scanSubfolders);
        if (cancelled) return;
        setFolders((current) =>
          current.map((folder) =>
            folder.path === seed.path
              ? { ...folder, previewCount: count }
              : folder
          )
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    config?.romFolders,
    currentStep,
    folders.length,
    previewFolder,
    system,
    visible,
  ]);

  const handleExecutableSelected = useCallback(
    async (path: string) => {
      if (!system) return;
      setPicker(null);
      const preview =
        await globalThis.window.electron.previewEmulatorExecutable(
          system,
          path
        );
      if (!preview) {
        showErrorToast("That file doesn't look like the right emulator.");
        return;
      }
      setConfig((curr) =>
        curr
          ? {
              ...curr,
              executablePath: preview.executablePath,
              detectedVersion: preview.detectedVersion,
            }
          : curr
      );
    },
    [system, showErrorToast]
  );

  const handleContinue = useCallback(async () => {
    if (
      currentStep === "find_emulator" &&
      system &&
      config?.executablePath &&
      config.executablePath !== initialConfig?.executablePath
    ) {
      let activeConfig: EmulatorConfig | null = null;
      for (const installSystem of installSystems) {
        const next = await globalThis.window.electron.setEmulatorExecutablePath(
          installSystem,
          config.executablePath
        );
        if (installSystem === system) activeConfig = next;
      }
      if (activeConfig) setConfig(activeConfig);
    }
    goNext();
  }, [
    config,
    currentStep,
    goNext,
    initialConfig?.executablePath,
    installSystems,
    system,
  ]);

  const handleFolderSelected = useCallback(
    async (folderPath: string) => {
      if (!system || picker?.kind !== "rom-folder") return;
      const replaceIndex = picker.replaceIndex;
      setPicker(null);

      if (
        folders.some(
          (folder, index) =>
            index !== replaceIndex && folder.path === folderPath
        )
      ) {
        return;
      }

      const previous = replaceIndex === null ? null : folders[replaceIndex];
      const scanSubfolders = previous?.scanSubfolders ?? true;
      setFolders((current) =>
        replaceIndex === null
          ? [
              ...current,
              { path: folderPath, scanSubfolders, previewCount: null },
            ]
          : current.map((folder, index) =>
              index === replaceIndex
                ? { path: folderPath, scanSubfolders, previewCount: null }
                : folder
            )
      );

      const count = await previewFolder(folderPath, scanSubfolders);
      setFolders((current) =>
        current.map((folder, index) =>
          (replaceIndex === null && folder.path === folderPath) ||
          index === replaceIndex
            ? { ...folder, previewCount: count }
            : folder
        )
      );
    },
    [folders, picker, previewFolder, system]
  );

  const handleRemoveFolder = useCallback((index: number) => {
    setFolders((current) =>
      current.filter((_, currentIndex) => currentIndex !== index)
    );
  }, []);

  const handleToggleSubfolders = useCallback(
    async (index: number) => {
      const folder = folders[index];
      const next = !folder.scanSubfolders;
      setFolders((prev) =>
        prev.map((f, i) =>
          i === index ? { ...f, scanSubfolders: next, previewCount: null } : f
        )
      );
      const count = await previewFolder(folder.path, next);
      setFolders((prev) =>
        prev.map((f, i) => (i === index ? { ...f, previewCount: count } : f))
      );
    },
    [folders, previewFolder]
  );

  // Kick off the real import when the scanning step is shown.
  useEffect(() => {
    if (!visible || !system) return;
    if (currentStep !== "scanning") return;
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;
    void start(
      system,
      folders.map((f) => ({ path: f.path, scanSubfolders: f.scanSubfolders }))
    );
  }, [visible, system, currentStep, folders, start]);

  // Refresh config once the scan lands so the overview reflects the new games.
  useEffect(() => {
    if (currentStep !== "scanning") return;
    if (scan.phase !== "done") return;
    void refreshConfig();
  }, [currentStep, scan.phase, refreshConfig]);

  const scanComplete = scan.phase === "done";
  const scanFailed = scan.phase === "error";

  const handleRetryScan = useCallback(async () => {
    if (!system) return;
    scanStartedRef.current = true;
    reset();
    await start(
      system,
      folders.map((folder) => ({
        path: folder.path,
        scanSubfolders: folder.scanSubfolders,
      }))
    );
  }, [folders, reset, start, system]);

  const continueDisabled = useMemo(() => {
    if (currentStep === "find_emulator") return !config?.executablePath;
    if (currentStep === "firmware") return !firmwareOk;
    if (currentStep === "bios") return !biosOk;
    if (currentStep === "keys") return !keysOk;
    if (currentStep === "rom_folder") return folders.length === 0;
    if (currentStep === "scanning") return !scanComplete;
    return true;
  }, [currentStep, config, firmwareOk, biosOk, keysOk, folders, scanComplete]);

  const handleSkip = useCallback(() => {
    if (
      currentStep === "firmware" ||
      currentStep === "bios" ||
      currentStep === "keys"
    ) {
      goNext();
    } else if (currentStep === "rom_folder" && system) {
      void refreshConfig();
      onComplete(system);
    }
  }, [currentStep, system, goNext, refreshConfig, onComplete]);

  // Focus the most relevant control each time the step or install view changes.
  useEffect(() => {
    if (!visible) return;
    const id = SETUP_PRIMARY_FOCUS_ID;
    const frame = globalThis.window.requestAnimationFrame(() => {
      setFocus(id);
    });
    return () => globalThis.window.cancelAnimationFrame(frame);
  }, [visible, stepIndex, showInstall, setFocus]);

  if (!visible || !system || !config) return null;

  const showBack =
    (stepIndex > 0 || showInstall) &&
    currentStep !== "scanning" &&
    currentStep !== "done";
  const showSkip =
    currentStep === "firmware" ||
    currentStep === "bios" ||
    currentStep === "keys" ||
    currentStep === "rom_folder";

  // Exactly one visible element owns SETUP_PRIMARY_FOCUS_ID per render. The
  // footer Continue owns it only when the step body has no primary CTA of its
  // own (emulator already found, or BIOS/firmware already installed); otherwise
  // the body's action button carries it and Continue falls back to its own id.
  const footerContinueOwnsPrimary =
    (currentStep === "find_emulator" && Boolean(config.executablePath)) ||
    (currentStep === "bios" && biosOk) ||
    (currentStep === "firmware" && firmwareOk);

  const handleBack = () => {
    if (showInstall) {
      setShowInstall(false);
      return;
    }
    goBack();
  };

  return (
    <>
      <Modal
        visible={visible}
        onClose={onClose}
        title={`Set up ${systemLabel}`}
        description={`Step ${stepIndex + 1} of ${steps.length}`}
        className="emulator-setup-modal"
        initialFocusId={SETUP_PRIMARY_FOCUS_ID}
      >
        <VerticalFocusGroup
          regionId="emulator-setup-region"
          className="emulator-setup"
        >
          <div className="emulator-setup__body">
            {currentStep === "find_emulator" && !showInstall && (
              <FindEmulatorStep
                config={config}
                detecting={detecting}
                onInstall={() => setShowInstall(true)}
                onBrowse={() => setPicker({ kind: "executable" })}
              />
            )}

            {currentStep === "find_emulator" && showInstall && (
              <InstallStep
                binary={config.binary}
                onInstalled={async () => {
                  setShowInstall(false);
                  setDetecting(true);
                  try {
                    const refreshed = await refreshConfig();
                    if (refreshed?.executablePath) return;
                    const preview =
                      await globalThis.window.electron.previewEmulatorExecutable(
                        system
                      );
                    if (!preview) return;
                    setConfig((curr) =>
                      curr
                        ? {
                            ...curr,
                            executablePath: preview.executablePath,
                            detectedVersion: preview.detectedVersion,
                          }
                        : curr
                    );
                  } finally {
                    setDetecting(false);
                  }
                }}
              />
            )}

            {currentStep === "bios" && (
              <BiosStep
                system={system}
                systemLabel={systemShort}
                config={config}
                onStatusChange={setBiosOk}
              />
            )}

            {currentStep === "firmware" && (
              <FirmwareStep
                config={config}
                systemLabel={systemShort}
                onStatusChange={setFirmwareOk}
              />
            )}

            {currentStep === "keys" && <KeysStep onStatusChange={setKeysOk} />}

            {currentStep === "rom_folder" && (
              <RomFolderStep
                systemLabel={systemShort}
                folders={folders}
                onAddFolder={() =>
                  setPicker({ kind: "rom-folder", replaceIndex: null })
                }
                onChangeFolder={(index) =>
                  setPicker({ kind: "rom-folder", replaceIndex: index })
                }
                onRemoveFolder={handleRemoveFolder}
                onToggleSubfolders={handleToggleSubfolders}
              />
            )}

            {currentStep === "scanning" && (
              <ScanningStep
                systemLabel={systemShort}
                percent={scan.percent}
                processed={scan.processed}
                total={scan.total}
                currentFile={scan.currentFile}
                matched={scan.matched}
                discovered={scan.discovered}
                sizeBytes={scan.sizeBytes}
                phase={scan.phase}
                error={scan.error}
              />
            )}

            {currentStep === "done" && (
              <DoneStep
                systemLabel={systemLabel}
                gamesAdded={scan.matched}
                onFinish={() => onComplete(system)}
              />
            )}
          </div>

          {currentStep !== "done" && (
            <div className="emulator-setup__footer">
              {showBack && (
                <Button variant="secondary" onClick={handleBack}>
                  Back
                </Button>
              )}

              {showSkip && !showInstall && (
                <Button variant="tertiary" onClick={handleSkip}>
                  Skip for now
                </Button>
              )}

              {currentStep === "scanning" && !scanComplete && (
                <Button
                  variant="secondary"
                  focusId={scanFailed ? undefined : SETUP_PRIMARY_FOCUS_ID}
                  onClick={() => {
                    cancel();
                    void refreshConfig();
                    onClose();
                  }}
                >
                  Cancel scan
                </Button>
              )}

              {currentStep === "scanning" && scanFailed ? (
                <Button
                  focusId={SETUP_PRIMARY_FOCUS_ID}
                  icon={<ArrowClockwiseIcon size={18} />}
                  onClick={() => {
                    void handleRetryScan();
                  }}
                >
                  Retry scan
                </Button>
              ) : null}

              {!showInstall && currentStep !== "scanning" && (
                <Button
                  focusId={
                    footerContinueOwnsPrimary
                      ? SETUP_PRIMARY_FOCUS_ID
                      : SETUP_CONTINUE_FOCUS_ID
                  }
                  disabled={continueDisabled}
                  onClick={handleContinue}
                >
                  Continue
                </Button>
              )}

              {!showInstall && currentStep === "scanning" && scanComplete && (
                <Button
                  focusId={SETUP_PRIMARY_FOCUS_ID}
                  onClick={handleContinue}
                >
                  Continue
                </Button>
              )}
            </div>
          )}
        </VerticalFocusGroup>
      </Modal>

      <FileExplorerModal
        visible={picker?.kind === "executable"}
        title={`Select ${systemLabel} emulator`}
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
        visible={picker?.kind === "rom-folder"}
        title={`Choose ${systemLabel} ROM folder`}
        initialPath={
          picker?.kind === "rom-folder" && picker.replaceIndex !== null
            ? folders[picker.replaceIndex]?.path
            : (folders[0]?.path ?? config.romFolders[0]?.path)
        }
        selectDirectory
        onClose={() => setPicker(null)}
        onSelect={(path) => {
          void handleFolderSelected(path);
        }}
      />
    </>
  );
}

interface FindEmulatorStepProps {
  config: EmulatorConfig;
  detecting: boolean;
  onInstall: () => void;
  onBrowse: () => void;
}

function FindEmulatorStep({
  config,
  detecting,
  onInstall,
  onBrowse,
}: Readonly<FindEmulatorStepProps>) {
  const found = config.executablePath !== null;

  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">Find the emulator</h3>
      <p className="emulator-setup__intro">
        GameHub looks for an installed emulator. If it isn&apos;t found, you can
        install one or browse for it.
      </p>

      <div
        className={`emulator-setup__status ${
          found ? "emulator-setup__status--ok" : "emulator-setup__status--warn"
        }`}
      >
        {found ? (
          <CheckCircleIcon size={24} weight="fill" />
        ) : (
          <WarningIcon size={24} weight="fill" />
        )}
        <div className="emulator-setup__status-text">
          <span className="emulator-setup__status-title">
            {detecting
              ? "Detecting emulator…"
              : found
                ? "Emulator found"
                : "Emulator not found"}
            {config.detectedVersion ? ` · v${config.detectedVersion}` : ""}
          </span>
          <span className="emulator-setup__status-path">
            {config.executablePath ?? "No executable detected yet."}
          </span>
        </div>
      </div>

      <div className="emulator-setup__inline-actions">
        {!found && (
          <Button
            focusId={SETUP_PRIMARY_FOCUS_ID}
            icon={<DownloadSimpleIcon size={18} />}
            onClick={onInstall}
          >
            Install automatically
          </Button>
        )}
        <Button variant="secondary" onClick={onBrowse}>
          Browse…
        </Button>
      </div>
    </div>
  );
}

interface InstallStepProps {
  binary: EmulatorConfig["binary"];
  onInstalled: () => void;
}

function InstallStep({ binary, onInstalled }: Readonly<InstallStepProps>) {
  const { showErrorToast } = useBigPictureToast();
  const [options, setOptions] = useState<ResolvedInstallOption[] | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions(null);
    globalThis.window.electron
      .getEmulatorInstallOptions(binary)
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [binary]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onEmulatorInstallProgress(
      (payload) => {
        if (payload.binary !== binary) return;
        if (payload.phase === "downloading") {
          const pct =
            payload.total && payload.total > 0
              ? Math.floor(((payload.loaded ?? 0) / payload.total) * 100)
              : 0;
          setProgressText(`Downloading… ${pct}%`);
        } else if (payload.phase === "extracting") {
          setProgressText("Extracting…");
        } else if (payload.phase === "running") {
          setProgressText(payload.reason ?? "Installing…");
        }
      }
    );
    return unsubscribe;
  }, [binary]);

  const installable = useMemo(
    () => (options ?? []).filter((option) => option.kind !== "link"),
    [options]
  );

  const handleInstall = async (optionId: string) => {
    if (installingId) return;
    setInstallingId(optionId);
    setProgressText("Starting…");
    try {
      const result = await globalThis.window.electron.installEmulator(
        binary,
        optionId
      );
      if (result.ok) {
        onInstalled();
      } else {
        showErrorToast(result.reason ?? "Install failed. Try again.");
      }
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Install failed. Try again."
      );
    } finally {
      setInstallingId(null);
      setProgressText(null);
    }
  };

  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">Install the emulator</h3>
      <p className="emulator-setup__intro">
        Pick a build to download and install automatically.
      </p>

      {options === null && (
        <p className="emulator-setup__intro">Loading options…</p>
      )}

      {options !== null && installable.length === 0 && (
        <p className="emulator-setup__intro">
          No automatic installer is available on this platform. Go back and
          browse for the executable instead.
        </p>
      )}

      <div className="emulator-setup__install-list">
        {installable.map((option, index) => {
          const isInstalling = installingId === option.id;
          const label =
            option.channel === "prerelease"
              ? "Pre-release"
              : option.channel === "release"
                ? "Stable"
                : "Install";
          return (
            <Button
              key={option.id}
              focusId={index === 0 ? SETUP_PRIMARY_FOCUS_ID : undefined}
              variant={index === 0 ? "primary" : "secondary"}
              loading={isInstalling}
              disabled={Boolean(installingId) && !isInstalling}
              icon={<DownloadSimpleIcon size={18} />}
              onClick={() => handleInstall(option.id)}
            >
              {isInstalling
                ? (progressText ?? "Installing…")
                : option.kind === "linux-flatpak"
                  ? "Install RetroArch + cores (user Flatpak)"
                  : `Install with GameHub · ${label}`}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

interface BiosStepProps {
  system: EmulatorSystem;
  systemLabel: string;
  config: EmulatorConfig;
  onStatusChange: (installed: boolean) => void;
}

function BiosStep({
  system,
  systemLabel,
  config,
  onStatusChange,
}: Readonly<BiosStepProps>) {
  const { showErrorToast } = useBigPictureToast();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const result = await globalThis.window.electron.checkEmulatorBios(
        system,
        config.executablePath
      );
      setInstalled(result.installed);
      onStatusChange(result.installed);
    } finally {
      setChecking(false);
    }
  }, [system, config.executablePath, onStatusChange]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const autoDownload = async () => {
    if (!config.executablePath) {
      showErrorToast("Set up the emulator before downloading its BIOS.");
      return;
    }
    setDownloading(true);
    setDownloadStatus("Starting…");
    const unsubscribe = globalThis.window.electron.onBiosDownloadProgress(
      (payload) => {
        if (payload.system !== system) return;
        const pct =
          payload.progress >= 0
            ? ` ${Math.round(payload.progress * 100)}%`
            : "";
        setDownloadStatus(`${payload.stage}${pct}`);
      }
    );
    try {
      const result =
        await globalThis.window.electron.downloadEmulatorBios(system);
      if (result.ok) {
        setDownloadStatus(null);
        await probe();
      } else {
        showErrorToast(result.error ?? "BIOS download failed.");
        setDownloadStatus(null);
      }
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "BIOS download failed."
      );
      setDownloadStatus(null);
    } finally {
      unsubscribe();
      setDownloading(false);
    }
  };

  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">{systemLabel} BIOS</h3>
      <p className="emulator-setup__intro">
        {systemLabel} games need a BIOS to boot. GameHub can download and
        install a compatible one for you.
      </p>

      <div
        className={`emulator-setup__status ${
          installed
            ? "emulator-setup__status--ok"
            : "emulator-setup__status--warn"
        }`}
      >
        {installed ? (
          <CheckCircleIcon size={24} weight="fill" />
        ) : (
          <WarningIcon size={24} weight="fill" />
        )}
        <div className="emulator-setup__status-text">
          <span className="emulator-setup__status-title">
            {installed ? "BIOS installed" : "BIOS not installed yet"}
          </span>
        </div>
      </div>

      <div className="emulator-setup__inline-actions">
        {!installed && (
          <Button
            focusId={SETUP_PRIMARY_FOCUS_ID}
            icon={<DownloadSimpleIcon size={18} />}
            loading={downloading}
            disabled={downloading || checking}
            onClick={autoDownload}
          >
            {downloading
              ? (downloadStatus ?? "Downloading…")
              : "Download automatically"}
          </Button>
        )}
        <Button
          variant="secondary"
          icon={<ArrowClockwiseIcon size={18} />}
          disabled={checking || downloading}
          onClick={probe}
        >
          Check again
        </Button>
      </div>
    </div>
  );
}

interface FirmwareStepProps {
  config: EmulatorConfig;
  systemLabel: string;
  onStatusChange: (installed: boolean) => void;
}

function FirmwareStep({
  config,
  systemLabel,
  onStatusChange,
}: Readonly<FirmwareStepProps>) {
  const { showErrorToast } = useBigPictureToast();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  const probe = useCallback(async () => {
    setChecking(true);
    try {
      const result = await globalThis.window.electron.checkPs3Firmware(
        config.executablePath
      );
      setInstalled(result.installed);
      onStatusChange(result.installed);
    } finally {
      setChecking(false);
    }
  }, [config.executablePath, onStatusChange]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const autoDownload = async () => {
    if (!config.executablePath) {
      showErrorToast("Set up the emulator before downloading its firmware.");
      return;
    }
    setDownloading(true);
    setDownloadStatus("Starting…");
    const unsubscribe = globalThis.window.electron.onBiosDownloadProgress(
      (payload) => {
        if (payload.system !== config.system) return;
        const pct =
          payload.progress >= 0
            ? ` ${Math.round(payload.progress * 100)}%`
            : "";
        setDownloadStatus(`${payload.stage}${pct}`);
      }
    );
    try {
      const result = await globalThis.window.electron.downloadEmulatorBios(
        config.system
      );
      if (result.ok) {
        setDownloadStatus(null);
        await probe();
      } else {
        showErrorToast(result.error ?? "Firmware download failed.");
        setDownloadStatus(null);
      }
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Firmware download failed."
      );
      setDownloadStatus(null);
    } finally {
      unsubscribe();
      setDownloading(false);
    }
  };

  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">{systemLabel} firmware</h3>
      <p className="emulator-setup__intro">
        {systemLabel} needs system firmware to boot games. GameHub can install
        it automatically.
      </p>

      <div
        className={`emulator-setup__status ${
          installed
            ? "emulator-setup__status--ok"
            : "emulator-setup__status--warn"
        }`}
      >
        {installed ? (
          <CheckCircleIcon size={24} weight="fill" />
        ) : (
          <WarningIcon size={24} weight="fill" />
        )}
        <div className="emulator-setup__status-text">
          <span className="emulator-setup__status-title">
            {installed ? "Firmware installed" : "Firmware not installed yet"}
          </span>
        </div>
      </div>

      <div className="emulator-setup__inline-actions">
        {!installed && (
          <Button
            focusId={SETUP_PRIMARY_FOCUS_ID}
            icon={<DownloadSimpleIcon size={18} />}
            loading={downloading}
            disabled={downloading || checking}
            onClick={autoDownload}
          >
            {downloading
              ? (downloadStatus ?? "Downloading…")
              : "Download automatically"}
          </Button>
        )}
        <Button
          variant="secondary"
          icon={<ArrowClockwiseIcon size={18} />}
          disabled={checking || downloading}
          onClick={probe}
        >
          Check again
        </Button>
      </div>
    </div>
  );
}

interface KeysStepProps {
  onStatusChange: (installed: boolean) => void;
}

function KeysStep({ onStatusChange }: Readonly<KeysStepProps>) {
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{
    keys: boolean;
    firmware: boolean;
    error?: string;
  } | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await globalThis.window.electron.downloadSwitchKeys();
      setResult(res);
      onStatusChange(res.keys);
      if (res.keys && res.firmware) {
        showSuccessToast("prod.keys and firmware installed. Eden is ready!");
      } else if (res.keys) {
        showSuccessToast("prod.keys installed. You can continue.");
      } else if (res.error) {
        showErrorToast(res.error);
      } else {
        showErrorToast("Keys install failed. Retry.");
      }
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Keys install failed."
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">Switch keys &amp; firmware</h3>
      <p className="emulator-setup__intro">
        Eden needs prod.keys and system firmware to boot Switch games. GameHub
        can download and install them automatically.
      </p>

      {result && (
        <div className="emulator-setup__status emulator-setup__status--neutral">
          <div className="emulator-setup__status-text">
            <span className="emulator-setup__status-title">
              prod.keys: {result.keys ? "Installed" : "Failed"}
            </span>
            <span className="emulator-setup__status-path">
              Firmware: {result.firmware ? "Installed" : "Failed"}
            </span>
          </div>
        </div>
      )}

      <div className="emulator-setup__inline-actions">
        <Button
          focusId={SETUP_PRIMARY_FOCUS_ID}
          icon={<DownloadSimpleIcon size={18} />}
          loading={downloading}
          disabled={downloading}
          onClick={handleDownload}
        >
          {downloading ? "Downloading…" : "Download keys & firmware"}
        </Button>
      </div>
    </div>
  );
}

interface RomFolderStepProps {
  systemLabel: string;
  folders: PendingFolder[];
  onAddFolder: () => void;
  onChangeFolder: (index: number) => void;
  onRemoveFolder: (index: number) => void;
  onToggleSubfolders: (index: number) => void;
}

function RomFolderStep({
  systemLabel,
  folders,
  onAddFolder,
  onChangeFolder,
  onRemoveFolder,
  onToggleSubfolders,
}: Readonly<RomFolderStepProps>) {
  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">Add your {systemLabel} games</h3>
      <p className="emulator-setup__intro">
        Choose the folder(s) where your {systemLabel} games live. GameHub will
        scan them and add matches to your library.
      </p>

      <div className="emulator-setup__folder-list">
        {folders.length === 0 && (
          <p className="emulator-setup__intro">No folders added yet.</p>
        )}

        {folders.map((folder, index) => (
          <div className="emulator-setup__folder-card" key={folder.path}>
            <div className="emulator-setup__folder-text">
              <span className="emulator-setup__folder-path">{folder.path}</span>
              {folder.previewCount !== null && (
                <span className="emulator-setup__folder-count">
                  {folder.previewCount} file
                  {folder.previewCount === 1 ? "" : "s"} found
                </span>
              )}
            </div>
            <Checkbox
              label="Scan subfolders"
              checked={folder.scanSubfolders}
              onChange={() => onToggleSubfolders(index)}
            />
            <div className="emulator-setup__folder-actions">
              <Button
                size="small"
                variant="secondary"
                icon={<PencilSimpleIcon size={16} />}
                onClick={() => onChangeFolder(index)}
              >
                Change
              </Button>
              <Button
                size="small"
                variant="danger"
                icon={<TrashIcon size={16} />}
                onClick={() => onRemoveFolder(index)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="emulator-setup__inline-actions">
        <Button
          focusId={SETUP_PRIMARY_FOCUS_ID}
          variant={folders.length === 0 ? "primary" : "secondary"}
          icon={<FolderPlusIcon size={18} />}
          onClick={onAddFolder}
        >
          {folders.length === 0 ? "Choose folder" : "Add another folder"}
        </Button>
      </div>
    </div>
  );
}

interface ScanningStepProps {
  systemLabel: string;
  percent: number;
  processed: number;
  total: number;
  currentFile: string | null;
  matched: number;
  discovered: number;
  sizeBytes: number;
  phase: string;
  error: string | null;
}

function ScanningStep({
  systemLabel,
  percent,
  processed,
  total,
  currentFile,
  matched,
  discovered,
  sizeBytes,
  phase,
  error,
}: Readonly<ScanningStepProps>) {
  const isDone = phase === "done";
  const isError = phase === "error";
  const indeterminate = !isDone && total === 0;
  const gamesValue = isDone || matched > 0 ? matched : discovered;

  return (
    <div className="emulator-setup__step">
      <h3 className="emulator-setup__title">
        {isDone
          ? "Scan complete"
          : isError
            ? "Scan interrupted"
            : `Scanning ${systemLabel} games`}
      </h3>
      <p className="emulator-setup__intro">
        {isDone
          ? "GameHub finished scanning your games."
          : isError
            ? (error ?? "The ROM scan could not be completed. Try again.")
            : "GameHub is matching your files against its game database."}
      </p>

      <div className="emulator-setup__progress-meta">
        <span>
          {isDone ? "Done" : phase === "matching" ? "Matching…" : "Scanning…"}
        </span>
        <span>
          {processed} / {Math.max(total, processed)}
        </span>
      </div>

      <div className="emulator-setup__progress-bar">
        <div
          className={`emulator-setup__progress-fill${
            indeterminate ? " emulator-setup__progress-fill--indeterminate" : ""
          }`}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>

      {!isDone && currentFile && (
        <p className="emulator-setup__scan-file">{currentFile}</p>
      )}

      <div className="emulator-setup__stats">
        <div className="emulator-setup__stat">
          <span className="emulator-setup__stat-label">Games</span>
          <span className="emulator-setup__stat-value">{gamesValue}</span>
        </div>
        <div className="emulator-setup__stat">
          <span className="emulator-setup__stat-label">Storage</span>
          <span className="emulator-setup__stat-value">
            {formatBytes(sizeBytes)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface DoneStepProps {
  systemLabel: string;
  gamesAdded: number;
  onFinish: () => void;
}

function DoneStep({
  systemLabel,
  gamesAdded,
  onFinish,
}: Readonly<DoneStepProps>) {
  return (
    <div className="emulator-setup__step emulator-setup__step--done">
      <CheckCircleIcon size={48} weight="fill" />
      <h3 className="emulator-setup__title">{systemLabel} is ready</h3>
      <p className="emulator-setup__intro">
        {gamesAdded} game{gamesAdded === 1 ? "" : "s"} added to your library.
      </p>
      <Button focusId={SETUP_PRIMARY_FOCUS_ID} onClick={onFinish}>
        Done
      </Button>
    </div>
  );
}
