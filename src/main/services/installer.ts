import { app, dialog, shell } from "electron";
import createDesktopShortcut from "create-desktop-shortcuts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SETUP_MARKER = ".gamehub-setup";
const PORTABLE_MARKER = "portable";

export function needsSetup(): boolean {
  if (process.platform !== "win32") return false;
  if (!app.isPackaged) return false;

  const exeDir = path.dirname(process.execPath);
  const marker = path.join(exeDir, SETUP_MARKER);
  if (fs.existsSync(marker)) return false;

  // After an NSIS auto-update the marker gets wiped but userData already
  // exists at the default Electron path. Re-create the marker so the wizard
  // never re-appears after an update.
  const defaultUserData = path.join(process.env.APPDATA ?? "", "GameHub");
  const hasExistingData =
    fs.existsSync(path.join(defaultUserData, "LOCK")) ||
    fs.existsSync(path.join(defaultUserData, "level-db")) ||
    fs.existsSync(path.join(defaultUserData, "legendary-config")) ||
    fs.existsSync(path.join(defaultUserData, "session"));
  if (hasExistingData) {
    try {
      fs.writeFileSync(marker, "", "utf8");
    } catch {
      // ignore
    }
    return false;
  }

  return true;
}

export function getInstallerDefaults() {
  return {
    defaultInstallDir: path.join(
      process.env.PROGRAMFILES || "C:\\Program Files",
      "GameHub"
    ),
    // Portable lives in a self-contained folder the user can move/copy at will
    // (defaults to a GameHub folder in their home directory).
    defaultPortableDir: path.join(app.getPath("home"), "GameHub"),
    exeDir: path.dirname(process.execPath),
  };
}

export async function browseForDirectory(
  defaultPath: string
): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose install folder",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled ? null : filePaths[0];
}

async function copyDirRecursive(
  src: string,
  dest: string,
  onFile?: (name: string) => void
): Promise<void> {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "data") continue;
      await copyDirRecursive(srcPath, destPath, onFile);
    } else {
      onFile?.(entry.name);
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeSetupMarker(dir: string) {
  fs.writeFileSync(path.join(dir, SETUP_MARKER), "", "utf8");
}

function createShortcuts(exePath: string) {
  if (process.platform !== "win32") return;

  const vbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const shortcutBase = {
    filePath: exePath,
    name: "GameHub",
    // Match the AppUserModelId set in main/index.ts so Windows replaces any
    // stale shortcut from a previous install rather than creating a duplicate.
    appUserModelId: "io.gamehub.launcher",
    VBScriptPath: vbsPath,
  };

  const desktop = app.getPath("desktop");
  const startMenu = path.join(
    process.env.APPDATA ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );

  // Remove stale shortcuts from any previous install location before writing
  // new ones so broken taskbar shortcuts don't persist after a move.
  for (const dir of [desktop, startMenu]) {
    const stale = path.join(dir, "GameHub.lnk");
    try {
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
    } catch {
      // ignore — can't remove a pinned taskbar shortcut from here
    }
  }

  createDesktopShortcut({ windows: { ...shortcutBase, outputPath: desktop } });
  createDesktopShortcut({
    windows: { ...shortcutBase, outputPath: startMenu },
  });
}

/**
 * Copies the unpacked app from the current (staging) folder into destDir,
 * skipping the runtime `data` directory. Reports progress 0→85.
 */
async function copyAppInto(
  destDir: string,
  onProgress: (pct: number, file: string) => void
): Promise<void> {
  const srcDir = path.dirname(process.execPath);

  // Nothing to copy if the user picked the folder we're already running from.
  if (path.resolve(srcDir) === path.resolve(destDir)) {
    onProgress(85, "Preparing…");
    return;
  }

  // Disable Electron's ASAR interception so app.asar is copied as a raw file
  process.noAsar = true;
  try {
    let total = 0;
    let copied = 0;
    const countFiles = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name === "data") continue;
          countFiles(path.join(dir, e.name));
        } else total++;
      }
    };
    countFiles(srcDir);

    onProgress(0, "Preparing…");

    await copyDirRecursive(srcDir, destDir, (name) => {
      copied++;
      onProgress(Math.round((copied / total) * 85), name);
    });
  } finally {
    process.noAsar = false;
  }
}

export async function setupInstall(
  destDir: string,
  onProgress: (pct: number, file: string) => void
): Promise<void> {
  await copyAppInto(destDir, onProgress);

  onProgress(88, "Creating shortcuts…");
  const newExe = path.join(destDir, path.basename(process.execPath));
  createShortcuts(newExe);

  onProgress(95, "Finishing up…");
  writeSetupMarker(destDir);
  scheduleStagingCleanup(destDir);

  onProgress(100, "Done");
}

export async function setupPortable(
  destDir: string,
  onProgress: (pct: number, file: string) => void
): Promise<void> {
  await copyAppInto(destDir, onProgress);

  onProgress(95, "Finishing up…");
  // Portable: keep the app + its data self-contained in destDir, no shortcuts,
  // no registry. The marker files make startup redirect userData to destDir/data.
  fs.writeFileSync(path.join(destDir, PORTABLE_MARKER), "", "utf8");
  writeSetupMarker(destDir);
  scheduleStagingCleanup(destDir);

  onProgress(100, "Done");
}

/**
 * After the app has been copied to the user's chosen Install/Portable folder
 * (and we're about to relaunch from there), remove the temporary folder the
 * setup.exe unpacked into so nothing is left behind under %LocalAppData%.
 *
 * We run the NSIS silent uninstaller, which cleanly removes both the staged
 * files and the Add/Remove Programs entry. `deleteAppDataOnUninstall: false`
 * means the user's real data (Roaming/portable folder) is never touched.
 *
 * If there's no NSIS uninstaller next to us (e.g. we were launched from a plain
 * extracted ZIP), we do nothing — we must never delete a folder we didn't stage.
 */
function scheduleStagingCleanup(destDir: string): void {
  if (process.platform !== "win32") return;

  const stagingDir = path.dirname(process.execPath);
  if (path.resolve(stagingDir) === path.resolve(destDir)) return;

  const uninstaller = path.join(stagingDir, "Uninstall GameHub.exe");
  if (!fs.existsSync(uninstaller)) return;

  // Wait a few seconds for this process to exit, then run the silent
  // uninstaller. Without `_?=` it copies itself to %TEMP% and removes the whole
  // staging directory (including itself) plus the registry uninstall entry.
  const cmd = `ping 127.0.0.1 -n 4 >nul & "${uninstaller}" /S`;
  try {
    spawn("cmd.exe", ["/c", cmd], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {
    // best-effort cleanup; safe to ignore
  }
}

export function relaunchFrom(destDir: string): void {
  const newExe = path.join(destDir, path.basename(process.execPath));
  app.relaunch({ execPath: newExe });
  app.exit(0);
}

export function openInstallFolder(destDir: string): void {
  shell.openPath(destDir);
}

/**
 * On every packaged launch, refresh Desktop and Start Menu shortcuts so they
 * always point to the current exe. This fixes stale shortcuts left behind when
 * the user switches from the old custom installer to a portable or NSIS build.
 * Pinned taskbar shortcuts cannot be updated programmatically — the user must
 * re-pin manually if theirs points to an old path.
 */
export function refreshShortcuts(): void {
  if (process.platform !== "win32") return;
  if (!app.isPackaged) return;
  try {
    createShortcuts(process.execPath);
  } catch {
    // ignore — non-critical
  }
}
