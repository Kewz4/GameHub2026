import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DesktopDownloadIcon,
  FileDirectoryIcon,
  SearchIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField } from "@renderer/components";
import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";
import { logger } from "@renderer/logger";

import "./settings-general.scss";
import "./settings-emulation.scss";

const SYSTEMS: { id: EmulatorSystem; label: string; emulator: string }[] = [
  { id: "ps1", label: "PlayStation 1", emulator: "DuckStation" },
  { id: "ps2", label: "PlayStation 2", emulator: "PCSX2" },
  { id: "ps3", label: "PlayStation 3", emulator: "RPCS3" },
];

function EmulatorSection({
  system,
  label,
  emulator,
  config,
  onConfigChange,
}: Readonly<{
  system: EmulatorSystem;
  label: string;
  emulator: string;
  config: EmulatorConfig | undefined;
  onConfigChange: (config: EmulatorConfig) => void;
}>) {
  const { t } = useTranslation("settings");
  const [detecting, setDetecting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const result = await window.electron.detectEmulator(system);
      if (result) onConfigChange(result);
    } catch (err) {
      logger.error(err);
    } finally {
      setDetecting(false);
    }
  }, [system, onConfigChange]);

  const handleBrowseExecutable = useCallback(async () => {
    const { filePaths, canceled } = await window.electron.showOpenDialog({
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return;
    try {
      const updated = await window.electron.setEmulatorExecutablePath(
        system,
        filePaths[0]
      );
      if (updated) onConfigChange(updated);
    } catch (err) {
      logger.error(err);
    }
  }, [system, onConfigChange]);

  const handleRemoveExecutable = useCallback(async () => {
    try {
      const updated = await window.electron.removeEmulator(system);
      onConfigChange(updated);
    } catch (err) {
      logger.error(err);
    }
  }, [system, onConfigChange]);

  const handleAddRomFolder = useCallback(async () => {
    const { filePaths, canceled } = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths.length) return;
    try {
      const updated = await window.electron.addRomFolder(
        system,
        filePaths[0],
        true
      );
      onConfigChange(updated);
    } catch (err) {
      logger.error(err);
    }
  }, [system, onConfigChange]);

  const handleRemoveRomFolder = useCallback(
    async (folderId: string) => {
      try {
        const updated = await window.electron.removeRomFolder(system, folderId);
        onConfigChange(updated);
      } catch (err) {
        logger.error(err);
      }
    },
    [system, onConfigChange]
  );

  const handleRescan = useCallback(async () => {
    setScanning(true);
    try {
      const updated = await window.electron.rescanEmulator(system);
      onConfigChange(updated);
    } catch (err) {
      logger.error(err);
    } finally {
      setScanning(false);
    }
  }, [system, onConfigChange]);

  const executablePath = config?.executablePath ?? null;
  const romFolders = config?.romFolders ?? [];

  return (
    <div className="settings-emulation__system">
      <div className="settings-emulation__system-header">
        <div className="settings-emulation__system-title">
          <h3>{label}</h3>
          <span className="settings-emulation__system-emulator">
            {emulator}
            {config?.detectedVersion ? ` ${config.detectedVersion}` : ""}
          </span>
        </div>

        <div className="settings-emulation__system-actions">
          <Button theme="outline" onClick={handleDetect} disabled={detecting}>
            <SearchIcon />
            {detecting ? t("detecting") : t("detect_emulator")}
          </Button>
        </div>
      </div>

      <div className="settings-emulation__field">
        <label className="settings-emulation__field-label">
          {t("emulator_executable_path")}
        </label>
        <div className="settings-emulation__field-row">
          <input
            type="text"
            readOnly
            value={executablePath ?? ""}
            placeholder={t("emulator_not_configured")}
            className="settings-emulation__input"
          />
          <Button theme="outline" onClick={handleBrowseExecutable}>
            <FileDirectoryIcon />
            {t("browse")}
          </Button>
          {executablePath && (
            <Button theme="danger" onClick={handleRemoveExecutable}>
              <TrashIcon />
            </Button>
          )}
        </div>
      </div>

      <div className="settings-emulation__field">
        <div className="settings-emulation__rom-header">
          <label className="settings-emulation__field-label">
            {t("rom_folders")}
          </label>
          <div className="settings-emulation__rom-actions">
            {romFolders.length > 0 && (
              <Button
                theme="outline"
                onClick={handleRescan}
                disabled={scanning}
              >
                <SyncIcon />
                {scanning ? t("scanning") : t("rescan")}
              </Button>
            )}
            <Button theme="outline" onClick={handleAddRomFolder}>
              <DesktopDownloadIcon />
              {t("add_rom_folder")}
            </Button>
          </div>
        </div>

        {romFolders.length === 0 ? (
          <p className="settings-emulation__empty">{t("no_rom_folders")}</p>
        ) : (
          <ul className="settings-emulation__rom-list">
            {romFolders.map((folder) => (
              <li key={folder.id} className="settings-emulation__rom-item">
                <div className="settings-emulation__rom-info">
                  <span className="settings-emulation__rom-path">
                    {folder.path}
                  </span>
                  <span className="settings-emulation__rom-meta">
                    {folder.fileCount} {t("games_found")}
                  </span>
                </div>
                <div className="settings-emulation__rom-controls">
                  <CheckboxField
                    label={t("scan_subfolders")}
                    checked={folder.scanSubfolders}
                    onChange={() =>
                      window.electron
                        .toggleRomFolderSubfolders(
                          system,
                          folder.id,
                          !folder.scanSubfolders
                        )
                        .then(onConfigChange)
                        .catch(logger.error)
                    }
                  />
                  <Button
                    theme="danger"
                    onClick={() => handleRemoveRomFolder(folder.id)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SettingsContextEmulation() {
  const { t } = useTranslation("settings");
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);

  useEffect(() => {
    window.electron
      .getEmulatorConfigs()
      .then(setConfigs)
      .catch((err) => {
        logger.error(err);
        setConfigs(null);
      });
  }, []);

  const handleConfigChange = useCallback((config: EmulatorConfig) => {
    setConfigs((previous) =>
      previous ? { ...previous, [config.system]: config } : previous
    );
  }, []);

  return (
    <div className="settings-context-panel settings-emulation">
      <p className="settings-emulation__description">
        {t("emulation_description")}
      </p>

      {SYSTEMS.map((entry) => (
        <EmulatorSection
          key={entry.id}
          system={entry.id}
          label={entry.label}
          emulator={entry.emulator}
          config={configs?.[entry.id]}
          onConfigChange={handleConfigChange}
        />
      ))}
    </div>
  );
}
