import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import {
  duckstationConfigCandidates,
  findExistingConfig,
} from "./emulator-config";

const DEFAULT_DIRS = (): string[] => {
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? "";
    return [
      path.join(os.homedir(), "Documents", "DuckStation", "memcards"),
      path.join(appdata, "DuckStation", "memcards"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "DuckStation",
        "memcards"
      ),
    ];
  }
  return [
    path.join(os.homedir(), ".local", "share", "duckstation", "memcards"),
    path.join(os.homedir(), ".config", "duckstation", "memcards"),
  ];
};

const memcardDirFromIni = (): string | null => {
  const iniPath = findExistingConfig(duckstationConfigCandidates());
  if (!iniPath) return null;
  try {
    const content = readFileSync(iniPath, "utf-8");
    const m = /^\s*MemcardDirectory\s*=\s*(.+)$/im.exec(content);
    return m ? m[1].trim() || null : null;
  } catch {
    return null;
  }
};

export const getPs1MemcardDirs = (): string[] => {
  const dirs: string[] = [];
  const iniDir = memcardDirFromIni();
  if (iniDir) dirs.push(iniDir);
  for (const d of DEFAULT_DIRS()) dirs.push(d);
  return Array.from(new Set(dirs)).filter((d) => existsSync(d));
};

export const findPs1MemcardFiles = (): string[] => {
  const files: string[] = [];
  for (const dir of getPs1MemcardDirs()) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (lower.endsWith(".mcd") || lower.endsWith(".mcr")) {
          files.push(path.join(dir, entry.name));
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return files;
};
