import { app, dialog, shell } from "electron";
import createDesktopShortcut from "create-desktop-shortcuts";
import fs from "node:fs";
import path from "node:path";

const SETUP_MARKER = ".gamehub-setup";

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
      process.env.LOCALAPPDATA || process.env.APPDATA || "C:\\Users\\Public",
      "GameHub"
    ),
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
  const vbsPath = app.isPackaged
    ? path.join(process.resourcesPath, "windows.vbs")
    : undefined;

  const shortcutBase = {
    filePath: exePath,
    name: "GameHub",
    VBScriptPath: vbsPath,
  };

  // Desktop
  createDesktopShortcut({
    windows: { ...shortcutBase, outputPath: app.getPath("desktop") },
  });

  // Start Menu
  const startMenu = path.join(
    process.env.APPDATA ?? "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );
  createDesktopShortcut({
    windows: { ...shortcutBase, outputPath: startMenu },
  });
}

export async function setupInstall(
  destDir: string,
  onProgress: (pct: number, file: string) => void
): Promise<void> {
  const srcDir = path.dirname(process.execPath);

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

    onProgress(88, "Creating shortcuts…");
    const newExe = path.join(destDir, path.basename(process.execPath));
    createShortcuts(newExe);

    onProgress(95, "Finishing up…");
    writeSetupMarker(destDir);

    onProgress(100, "Done");
  } finally {
    process.noAsar = false;
  }
}

export function setupPortable(): void {
  const dir = path.dirname(process.execPath);
  fs.writeFileSync(path.join(dir, "portable"), "", "utf8");
  writeSetupMarker(dir);
}

export function relaunchFrom(destDir: string): void {
  const newExe = path.join(destDir, path.basename(process.execPath));
  app.relaunch({ execPath: newExe });
  app.exit(0);
}

export function openInstallFolder(destDir: string): void {
  shell.openPath(destDir);
}
