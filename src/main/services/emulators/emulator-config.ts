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
  executablePath?: string | null
): string[] => {
  const candidates: string[] = [];

  // Portable mode: if portable.ini exists next to the exe, PCSX2 reads its
  // config from <exe_dir>/inis/PCSX2.ini and writes memcards to
  // <exe_dir>/memcards. This MUST be checked first so portable installs
  // resolve correctly for cloud sync.
  if (executablePath) {
    const exeDir = path.dirname(executablePath);
    if (existsSync(path.join(exeDir, "portable.ini"))) {
      candidates.push(path.join(exeDir, "inis", "PCSX2.ini"));
    }
  }

  if (process.platform === "win32") {
    candidates.push(
      path.join(os.homedir(), "Documents", "PCSX2", "inis", "PCSX2.ini"),
      path.join(process.env.APPDATA ?? "", "PCSX2", "inis", "PCSX2.ini")
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "PCSX2",
        "inis",
        "PCSX2.ini"
      )
    );
  } else {
    candidates.push(
      path.join(os.homedir(), ".local", "share", "PCSX2", "inis", "PCSX2.ini"),
      path.join(os.homedir(), ".config", "PCSX2", "inis", "PCSX2.ini")
    );
  }

  return candidates;
};

export const findExistingConfig = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};
