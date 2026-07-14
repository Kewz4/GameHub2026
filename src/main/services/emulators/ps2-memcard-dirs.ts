import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { readFileSync } from "node:fs";

import { pcsx2ConfigCandidates, findExistingConfig } from "./emulator-config";

const DEFAULT_DIRS = (): string[] => {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? "";
    return [
      path.join(os.homedir(), "Documents", "PCSX2", "memcards"),
      path.join(appdata, "PCSX2", "memcards"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "PCSX2",
        "memcards"
      ),
    ];
  }
  return [
    path.join(os.homedir(), ".local", "share", "PCSX2", "memcards"),
    path.join(os.homedir(), ".config", "PCSX2", "memcards"),
  ];
};

const memcardDirFromIni = (executablePath?: string | null): string | null => {
  const iniPath = findExistingConfig(pcsx2ConfigCandidates(executablePath));
  if (!iniPath) return null;
  try {
    const content = readFileSync(iniPath, "utf-8");
    const m = /^\s*MemcardDirectory\s*=\s*(.+)$/im.exec(content);
    return m ? m[1].trim() || null : null;
  } catch {
    return null;
  }
};

export const getPs2MemcardDirs = (executablePath?: string | null): string[] => {
  const dirs: string[] = [];

  // 1. MemcardDirectory from PCSX2.ini (now resolves portable configs too)
  const iniDir = memcardDirFromIni(executablePath);
  if (iniDir) dirs.push(iniDir);

  // 2. Portable mode: <exe_dir>/memcards (created by writePortableSetup)
  if (executablePath) {
    const exeDir = path.dirname(executablePath);
    if (existsSync(path.join(exeDir, "portable.ini"))) {
      dirs.push(path.join(exeDir, "memcards"));
    }
  }

  // 3. Default system paths
  for (const d of DEFAULT_DIRS()) dirs.push(d);

  return Array.from(new Set(dirs)).filter((d) => existsSync(d));
};

export const findPs2MemcardFiles = (
  executablePath?: string | null
): string[] => {
  const files: string[] = [];
  for (const dir of getPs2MemcardDirs(executablePath)) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (lower.endsWith(".ps2") || lower.endsWith(".mc2")) {
          files.push(path.join(dir, entry.name));
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return files;
};
