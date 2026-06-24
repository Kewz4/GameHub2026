import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";

export {
  getEmulatorConfig,
  getAllEmulatorConfigs,
  setEmulatorConfig,
  updateEmulatorConfig,
  recomputeTotals,
  resetEmulatorScanData,
} from "./emulators-repository";

export const duckstationConfigCandidates = (): string[] => {
  if (process.platform === "win32") {
    return [
      path.join(os.homedir(), "Documents", "DuckStation", "settings.ini"),
      path.join(process.env.APPDATA ?? "", "DuckStation", "settings.ini"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "DuckStation",
        "settings.ini"
      ),
    ];
  }
  return [
    path.join(os.homedir(), ".local", "share", "duckstation", "settings.ini"),
    path.join(os.homedir(), ".config", "duckstation", "settings.ini"),
  ];
};

export const pcsx2ConfigCandidates = (
  _executablePath?: string | null
): string[] => {
  if (process.platform === "win32") {
    return [
      path.join(os.homedir(), "Documents", "PCSX2", "inis", "PCSX2.ini"),
      path.join(process.env.APPDATA ?? "", "PCSX2", "inis", "PCSX2.ini"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "PCSX2",
        "inis",
        "PCSX2.ini"
      ),
    ];
  }
  return [
    path.join(os.homedir(), ".local", "share", "PCSX2", "inis", "PCSX2.ini"),
    path.join(os.homedir(), ".config", "PCSX2", "inis", "PCSX2.ini"),
  ];
};

export const findExistingConfig = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};
