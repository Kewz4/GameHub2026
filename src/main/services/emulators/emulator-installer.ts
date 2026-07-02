import axios from "axios";
import {
  chmodSync,
  cpSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { app } from "electron";
import { pipeline } from "node:stream/promises";

import type {
  EmulatorBinary,
  EmulatorInstallProgress,
  EmulatorInstallResult,
  EmulatorSystem,
} from "@types";
import { emulatorsInstallPath } from "@main/constants";
import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { ALL_SYSTEMS, KNOWN_BINARIES } from "./known-binaries";
import { resolveInstallOptionById } from "./emulator-install-sources";
import { updateEmulatorConfig } from "./emulators-repository";

const isWindows = process.platform === "win32";

/** Bundled RALibretro assets (cores + default configs + N64 system files). */
const ralibretroAssetsDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "ralibretro")
    : path.join(__dirname, "..", "..", "resources", "ralibretro");

/**
 * Seed a fresh RALibretro install with the bundled cores and default configs so
 * it runs games out of the box: copies the 5 libretro cores + their option
 * files, the N64 system catalog, and writes our default RALibretro.json
 * (F11 = fullscreen) and RAPrefs (RA overlay notifications OFF so GameHub's own
 * achievement overlay is used). Never overwrites an existing RAPrefs so a user
 * who already logged into RetroAchievements keeps their account.
 */
function preSetupRalibretro(installDir: string): void {
  const assets = ralibretroAssetsDir();
  if (!existsSync(assets)) {
    logger.warn(`RALibretro assets not found at ${assets}`);
    return;
  }

  // Cores + N64 system files (safe to overwrite — they're our pinned versions).
  const coresSrc = path.join(assets, "Cores");
  if (existsSync(coresSrc)) {
    cpSync(coresSrc, path.join(installDir, "Cores"), { recursive: true });
  }
  const systemSrc = path.join(assets, "System");
  if (existsSync(systemSrc)) {
    cpSync(systemSrc, path.join(installDir, "System"), { recursive: true });
  }

  // Runtime dirs RALibretro expects.
  for (const dir of ["Saves", "Screenshots", "RACache"]) {
    mkdirSync(path.join(installDir, dir), { recursive: true });
  }

  // Global config (bindings incl. F11 fullscreen) — refresh to our defaults.
  const cfgSrc = path.join(assets, "config", "RALibretro.json");
  if (existsSync(cfgSrc)) {
    copyFileSync(cfgSrc, path.join(installDir, "RALibretro.json"));
  }

  // RA prefs (notifications OFF). Only write if absent so we never clobber an
  // existing RetroAchievements login.
  const prefsSrc = path.join(assets, "config", "RAPrefs_RALibRetro.cfg");
  const prefsDest = path.join(installDir, "RAPrefs_RALibRetro.cfg");
  if (existsSync(prefsSrc) && !existsSync(prefsDest)) {
    copyFileSync(prefsSrc, prefsDest);
  }

  logger.log(`RALibretro pre-setup complete at ${installDir}`);
}

const systemsForBinary = (binary: EmulatorBinary): EmulatorSystem[] =>
  ALL_SYSTEMS.filter((system) => KNOWN_BINARIES[system].binary === binary);

const executableNamesFor = (binary: EmulatorBinary): string[] => {
  const primarySystem = systemsForBinary(binary)[0];
  // An orphaned binary (no system maps to it, e.g. a stale config predating a
  // registry change) has no known executable names — fail with an empty list
  // rather than crashing on `KNOWN_BINARIES[undefined]`.
  if (!primarySystem) return [];
  const known = KNOWN_BINARIES[primarySystem];
  return isWindows ? known.windowsNames : known.linuxNames;
};

/** Recursively locate the emulator executable inside an extracted directory. */
const findExecutable = (root: string, names: string[]): string | null => {
  const lowerNames = names.map((n) => n.toLowerCase());
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }

      if (isDir) {
        stack.push(full);
      } else if (lowerNames.includes(entry.toLowerCase())) {
        return full;
      }
    }
  }

  return null;
};

const downloadToFile = async (
  url: string,
  destPath: string,
  onProgress: (loaded: number, total: number) => void
): Promise<void> => {
  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: "stream",
    timeout: 0,
    maxRedirects: 5,
  });

  const total = Number(response.headers["content-length"] ?? 0);
  let loaded = 0;
  response.data.on("data", (chunk: Buffer) => {
    loaded += chunk.length;
    onProgress(loaded, total);
  });

  await pipeline(response.data, createWriteStream(destPath));
};

export const installEmulator = async (
  binary: EmulatorBinary,
  optionId: string,
  onProgress: (p: EmulatorInstallProgress) => void
): Promise<EmulatorInstallResult> => {
  const emit = (
    phase: EmulatorInstallProgress["phase"],
    extra?: Partial<EmulatorInstallProgress>
  ) => onProgress({ binary, optionId, phase, ...extra });

  try {
    const option = await resolveInstallOptionById(binary, optionId);
    if (!option || !option.downloadUrl) {
      return { ok: false, reason: "No downloadable asset for this option" };
    }

    const installDir = path.join(emulatorsInstallPath, binary);
    // Fresh install — clear any previous build so stale executables don't win.
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true, force: true });
    }
    mkdirSync(installDir, { recursive: true });

    const fileName = option.fileName ?? `${binary}-download`;
    const archivePath = path.join(installDir, fileName);

    emit("downloading", { loaded: 0, total: 0 });
    await downloadToFile(option.downloadUrl, archivePath, (loaded, total) =>
      emit("downloading", { loaded, total })
    );

    let executablePath: string | null = null;

    if (option.kind === "linux-appimage") {
      // AppImages run directly; just make them executable.
      chmodSync(archivePath, 0o755);
      executablePath = archivePath;
    } else if (option.kind === "windows-installer") {
      // An NSIS/Inno .exe is not an archive — feeding it to 7-Zip yields a few
      // junk files ($PLUGINSDIR), not a usable build. We don't silently run
      // installers, so surface this instead of pretending it worked.
      return {
        ok: false,
        reason:
          "This emulator only ships a Windows installer (.exe). Use the release page option to install it.",
      };
    } else {
      emit("extracting");
      const extraction = await SevenZip.extractFile({
        filePath: archivePath,
        outputPath: installDir,
      });
      rmSync(archivePath, { force: true });
      // A correct extract yields many files; 0–1 means we grabbed the wrong
      // asset (symbols/libretro core) or the archive was bad.
      if (!extraction.success || extraction.extractedFiles.length <= 1) {
        return {
          ok: false,
          reason: `Extraction produced ${extraction.extractedFiles.length} file(s) — the downloaded asset was not a full emulator build.`,
        };
      }
      executablePath = findExecutable(installDir, executableNamesFor(binary));
    }

    if (!executablePath || !existsSync(executablePath)) {
      return { ok: false, reason: "Could not locate the emulator executable" };
    }

    // RALibretro ships as a bare exe — pre-seed the cores + default configs so
    // it's playable immediately (no manual core download / RA overlay setup).
    if (binary === "ralibretro") {
      try {
        preSetupRalibretro(path.dirname(executablePath));
      } catch (err) {
        logger.error("RALibretro pre-setup failed", err);
      }
    }

    if (!isWindows) {
      try {
        chmodSync(executablePath, 0o755);
      } catch {
        /* best effort */
      }
    }

    // Persist the executable for every system this binary serves. `binary` is
    // set explicitly (not just spread from `current`) so a stale persisted
    // config — from before this system's registry mapping changed — is
    // corrected the moment a fresh install succeeds, not left pointing at
    // whatever binary it used to target.
    const now = Date.now();
    for (const system of systemsForBinary(binary)) {
      await updateEmulatorConfig(system, (current) => ({
        ...current,
        binary,
        executablePath,
        detectedVersion: option.version ?? current.detectedVersion,
        detectedAt: now,
      }));
    }

    emit("done", { path: executablePath });
    logger.log(`Emulator installed: ${binary} → ${executablePath}`);
    return { ok: true, path: executablePath };
  } catch (err) {
    logger.error(`Emulator install failed for ${binary}`, err);
    emit("error", { reason: String(err) });
    return { ok: false, reason: String(err) };
  }
};
