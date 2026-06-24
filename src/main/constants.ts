import { app } from "electron";
import path from "node:path";
import { SystemPath } from "./services/system-path";

export const defaultDownloadsPath = SystemPath.getPath("downloads");

export const isStaging = import.meta.env.MAIN_VITE_API_URL.includes("staging");

export const windowsStartMenuPath = path.join(
  SystemPath.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs"
);

export const publicProfilePath = "C:/Users/Public";

// Portable installs store all user data next to the exe.
// Check both PORTABLE_EXECUTABLE_DIR (NSIS portable) and a "portable" marker
// file next to the exe (our custom installer).  app.setPath() already ran in
// index.ts, but constants.ts is evaluated independently so we re-derive it.
//
// Also, on first run (before .gamehub-setup marker exists) we use the exe dir
// so that Roaming is never touched until the user explicitly chooses "Install".
import fs from "node:fs";
const SETUP_MARKER = ".gamehub-setup";
const _portableDir =
  process.env.PORTABLE_EXECUTABLE_DIR ||
  (() => {
    try {
      const exeDir = path.dirname(process.execPath);
      if (fs.existsSync(path.join(exeDir, "portable"))) return exeDir;
      // First run on Windows packaged build — setup not yet complete
      if (
        process.platform === "win32" &&
        app.isPackaged &&
        !fs.existsSync(path.join(exeDir, SETUP_MARKER))
      ) {
        return exeDir;
      }
    } catch {
      return null;
    }
    return null;
  })();
const portableDataDir = _portableDir ? path.join(_portableDir, "data") : null;

const getUserDataPath = () => portableDataDir ?? SystemPath.getPath("userData");

export const levelDatabasePath = path.join(
  getUserDataPath(),
  `gamehub-db${isStaging ? "-staging" : ""}`
);

export const commonRedistPath = path.join(getUserDataPath(), "CommonRedist");

export const logsPath = path.join(
  getUserDataPath(),
  `logs${isStaging ? "-staging" : ""}`
);

export const achievementSoundPath = app.isPackaged
  ? path.join(process.resourcesPath, "achievement.wav")
  : path.join(__dirname, "..", "..", "resources", "achievement.wav");

export const backupsPath = path.join(getUserDataPath(), "Backups");

/** Root folder under which portable emulator builds are installed. */
export const emulatorsInstallPath = path.join(getUserDataPath(), "emulators");

export const appVersion = app.getVersion() + (isStaging ? "-staging" : "");

export const ASSETS_PATH = path.join(getUserDataPath(), "Assets");

export const THEMES_PATH = path.join(getUserDataPath(), "themes");

export const INTERVALS = {
  processWatcher: 2_000,
  downloadWatcher: 2_000,
  achievementWatcher: 2_000,
  seedStatusWatcher: 2_000,
  updateChecker: 60_000 * 50, // 50 minutes
  powerSaveBlockerSync: 20_000,
  librarySync: 6 * 60 * 60 * 1000, // 6 hours
  exophaseSync: 2 * 60 * 60 * 1000, // 2 hours — Exophase achievement cache refresh
};

export const DEFAULT_ACHIEVEMENT_SOUND_VOLUME = 0.15;

export const DECKY_PLUGINS_LOCATION = path.join(
  SystemPath.getPath("home"),
  "homebrew",
  "plugins"
);

export const GAMEHUB_DECKY_PLUGIN_LOCATION = path.join(
  DECKY_PLUGINS_LOCATION,
  "GameHub"
);
