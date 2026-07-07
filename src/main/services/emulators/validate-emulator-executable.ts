import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  findMacAppBundleRoot,
  resolveMacAppBundleExecutable,
} from "./macos-app-bundle";

const NON_EXECUTABLE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".webm",
  ".txt",
  ".md",
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".xz",
  ".iso",
  ".bin",
  ".cue",
  ".chd",
  ".pkg",
  ".cso",
  ".json",
  ".xml",
  ".ini",
  ".cfg",
  ".log",
  ".html",
  ".htm",
]);

export const isValidEmulatorExecutable = (executablePath: string): boolean => {
  if (!executablePath) return false;
  const normalizedPath = path.normalize(executablePath);
  if (!existsSync(normalizedPath)) return false;
  const ext = path.extname(normalizedPath).toLowerCase();
  const appBundlePath = findMacAppBundleRoot(normalizedPath);
  if (appBundlePath) {
    return (
      ext === ".app" && resolveMacAppBundleExecutable(appBundlePath) !== null
    );
  }
  try {
    const stat = statSync(normalizedPath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  if (NON_EXECUTABLE_EXTENSIONS.has(ext)) return false;
  if (process.platform === "win32") {
    // Accept any file that isn't obviously a non-executable (blocked above).
    // Emulators usually ship as .exe, but some launchers are .bat/.cmd/.com or
    // an unusually named binary — the blocklist already excludes ROMs, media,
    // archives and configs, so anything left is a plausible launcher.
    return true;
  }
  try {
    accessSync(normalizedPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
