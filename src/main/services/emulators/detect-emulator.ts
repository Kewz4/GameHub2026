import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { EmulatorSystem } from "@types";
import { KNOWN_BINARIES } from "./known-binaries";

const safeReaddir = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

const findInPath = (names: string[]): string | null => {
  const cmd = process.platform === "win32" ? "where" : "which";
  for (const name of names) {
    try {
      const result = spawnSync(cmd, [name], {
        encoding: "utf-8",
        timeout: 3000,
      });
      if (result.status === 0 && result.stdout.trim()) {
        const found = result.stdout.trim().split("\n")[0].trim();
        if (existsSync(found)) return found;
      }
    } catch {
      // continue
    }
  }
  return null;
};

const searchDirectories = (dirs: string[], names: string[]): string | null => {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

export interface DetectionResult {
  executablePath: string;
}

export const detectEmulator = async (
  system: EmulatorSystem
): Promise<DetectionResult | null> => {
  const binary = KNOWN_BINARIES[system];

  if (process.platform === "win32") {
    const names = binary.windowsNames;
    const programFiles = [
      process.env["ProgramFiles"] ?? "C:\\Program Files",
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      process.env["LOCALAPPDATA"]
        ? path.join(process.env["LOCALAPPDATA"], "Programs")
        : null,
    ].filter(Boolean) as string[];

    const inPf = searchDirectories(programFiles, names);
    if (inPf) return { executablePath: inPf };

    const inPath = findInPath(names);
    if (inPath) return { executablePath: inPath };

    const home = process.env["USERPROFILE"] ?? "";
    for (const subdir of ["Downloads", "Desktop", "Emulators"]) {
      if (!home) continue;
      const dir = path.join(home, subdir);
      for (const name of names) {
        for (const entry of safeReaddir(dir)) {
          const candidate = path.join(dir, entry, name);
          if (existsSync(candidate)) return { executablePath: candidate };
        }
      }
    }
  } else {
    const names = binary.linuxNames;
    const inPath = findInPath(names);
    if (inPath) return { executablePath: inPath };

    const flatpakDirs = [
      "/var/lib/flatpak/exports/bin",
      process.env["HOME"]
        ? path.join(process.env["HOME"], ".local/share/flatpak/exports/bin")
        : null,
    ].filter(Boolean) as string[];

    for (const id of binary.flatpakIds) {
      for (const dir of flatpakDirs) {
        const candidate = path.join(dir, id);
        if (existsSync(candidate)) return { executablePath: candidate };
      }
    }

    const appImageDirs = [
      process.env["HOME"]
        ? path.join(process.env["HOME"], "Applications")
        : null,
      process.env["HOME"] ? path.join(process.env["HOME"], ".local/bin") : null,
    ].filter(Boolean) as string[];

    for (const dir of appImageDirs) {
      for (const file of safeReaddir(dir)) {
        const lower = file.toLowerCase();
        if (
          names.some((n) => lower.includes(n.toLowerCase())) &&
          lower.endsWith(".appimage")
        ) {
          return { executablePath: path.join(dir, file) };
        }
      }
    }
  }

  return null;
};
