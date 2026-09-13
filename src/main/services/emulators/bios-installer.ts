import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { SystemPath } from "../system-path";
import { SevenZip } from "../7zip";
import { logger } from "../logger";
import { getEmulatorConfig } from "./emulators-repository";
import { resolvePs1BiosDirs, resolvePs2BiosDirs } from "./bios-detection";
import type { EmulatorSystem } from "@types";
import { emulatorUserPaths } from "./emulator-user-paths";
import { retroArchSystemDirectory } from "./retroarch-linux";

// Direct BIOS / firmware sources. PS1 + PS2 are the standard USA dumps; PS3 is
// Sony's official signed firmware PUP, installed through RPCS3 itself.
const BIOS_SOURCES = {
  ps1: {
    url: "https://file.ps2biosonline.com/SCPH1001.BIN",
    kind: "file" as const,
    fileName: "SCPH1001.BIN",
  },
  ps2: {
    url: "https://file.ps2biosonline.com/ps2-bios-usa.zip",
    kind: "zip" as const,
  },
  ps3: {
    url: "http://dus01.ps3.update.playstation.net/update/ps3/image/us/2026_0318_a2b60b6ac1d2e49e230144345616927c/PS3UPDAT.PUP",
    kind: "firmware" as const,
    fileName: "PS3UPDAT.PUP",
  },
};

export type BiosInstallStage = "downloading" | "extracting" | "installing";

export interface BiosInstallProgress {
  system: EmulatorSystem;
  stage: BiosInstallStage;
  /** 0–1 for the current stage, or -1 when indeterminate. */
  progress: number;
}

type ProgressCb = (p: BiosInstallProgress) => void;

/** Stream a URL to disk, reporting download progress against content-length. */
async function downloadTo(
  url: string,
  dest: string,
  system: EmulatorSystem,
  onProgress?: ProgressCb
): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 0,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const total = Number(response.headers["content-length"]) || 0;
  let received = 0;
  response.data.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onProgress?.({
      system,
      stage: "downloading",
      progress: total > 0 ? received / total : -1,
    });
  });
  await pipeline(response.data, fs.createWriteStream(dest));
}

/**
 * Pick where to write a console's BIOS. Prefer a folder the emulator already
 * reads from; otherwise create a `bios` folder next to its executable (both
 * DuckStation and PCSX2 read a `bios` folder relative to the binary).
 */
async function resolveTargetBiosDir(
  system: "ps1" | "ps2",
  executablePath: string
): Promise<string> {
  const existing =
    system === "ps1"
      ? await resolvePs1BiosDirs(executablePath)
      : await resolvePs2BiosDirs(executablePath);
  if (existing.length > 0) return existing[0];
  if (process.platform === "linux" && system === "ps1") {
    const target = retroArchSystemDirectory(path.dirname(executablePath));
    await fs.promises.mkdir(target, { recursive: true });
    return target;
  }

  const fallback = path.join(
    emulatorUserPaths(
      system === "ps2" ? "pcsx2" : "duckstation",
      path.dirname(executablePath)
    ).data,
    "bios"
  );
  await fs.promises.mkdir(fallback, { recursive: true });
  return fallback;
}

async function installPs1Bios(
  executablePath: string,
  onProgress?: ProgressCb
): Promise<void> {
  const dir = await resolveTargetBiosDir("ps1", executablePath);
  const dest = path.join(dir, BIOS_SOURCES.ps1.fileName);
  await downloadTo(BIOS_SOURCES.ps1.url, dest, "ps1", onProgress);
  logger.log(`[bios] PS1 BIOS installed to ${dest}`);
}

// PS2 BIOS companion extensions PCSX2 reads alongside the main .BIN.
const PS2_BIOS_EXTS = new Set([
  ".bin",
  ".mec",
  ".nvm",
  ".rom1",
  ".rom2",
  ".erom",
]);

/** Recursively collect BIOS files from an extracted tree (skips macOS junk). */
async function collectPs2BiosFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.promises.readdir(dir, {
      withFileTypes: true,
    })) {
      if (entry.name === "__MACOSX" || entry.name.startsWith("._")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (PS2_BIOS_EXTS.has(path.extname(entry.name).toLowerCase()))
        out.push(full);
    }
  };
  await walk(root);
  return out;
}

async function installPs2Bios(
  executablePath: string,
  onProgress?: ProgressCb
): Promise<void> {
  const dir = await resolveTargetBiosDir("ps2", executablePath);
  const zipPath = path.join(
    SystemPath.getPath("temp"),
    `ps2-bios-${Date.now()}.zip`
  );
  await downloadTo(BIOS_SOURCES.ps2.url, zipPath, "ps2", onProgress);

  onProgress?.({ system: "ps2", stage: "extracting", progress: -1 });
  const extractDir = path.join(
    SystemPath.getPath("temp"),
    `ps2-bios-extract-${Date.now()}`
  );
  await SevenZip.extractFile({ filePath: zipPath, outputPath: extractDir });

  // The archive nests each BIOS revision in its own folder; PCSX2 lists BIOS
  // images from the bios folder, so flatten every .BIN (+ NVM/MEC companions)
  // into the target dir.
  const biosFiles = await collectPs2BiosFiles(extractDir);
  if (biosFiles.length === 0) {
    throw new Error("No PS2 BIOS files found in the downloaded archive");
  }
  for (const file of biosFiles) {
    await fs.promises.copyFile(file, path.join(dir, path.basename(file)));
  }

  await fs.promises.rm(extractDir, { recursive: true, force: true });
  await fs.promises.unlink(zipPath).catch(() => {});
  logger.log(
    `[bios] PS2 BIOS: ${biosFiles.length} file(s) installed to ${dir}`
  );
}

async function installPs3Firmware(
  executablePath: string,
  onProgress?: ProgressCb
): Promise<void> {
  const pupPath = path.join(
    SystemPath.getPath("temp"),
    BIOS_SOURCES.ps3.fileName
  );
  await downloadTo(BIOS_SOURCES.ps3.url, pupPath, "ps3", onProgress);

  // RPCS3 installs firmware from a PUP via `--installfw` (extracts into
  // dev_flash). Run it headless and wait for it to finish.
  onProgress?.({ system: "ps3", stage: "installing", progress: -1 });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, ["--installfw", pupPath], {
      cwd: path.dirname(executablePath),
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error("RPCS3 firmware install timed out"));
    }, 20 * 60_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`RPCS3 firmware install exited with code ${code}`));
    });
  });
  await fs.promises.unlink(pupPath).catch(() => {});
  logger.log("[bios] PS3 firmware installed via RPCS3 --installfw");
}

/**
 * Download and install the BIOS/firmware for a console emulator. Returns false
 * (with a reason) when the emulator isn't configured, since we need its
 * executable to know where the BIOS goes (and, for PS3, to run the installer).
 */
export async function downloadEmulatorBios(
  system: EmulatorSystem,
  onProgress?: ProgressCb
): Promise<{ ok: boolean; error?: string }> {
  if (system !== "ps1" && system !== "ps2" && system !== "ps3") {
    return { ok: false, error: "unsupported_system" };
  }

  const config = await getEmulatorConfig(system).catch(() => null);
  if (!config?.executablePath) {
    return { ok: false, error: "emulator_not_configured" };
  }

  try {
    if (system === "ps1") {
      await installPs1Bios(config.executablePath, onProgress);
    } else if (system === "ps2") {
      await installPs2Bios(config.executablePath, onProgress);
    } else {
      await installPs3Firmware(config.executablePath, onProgress);
    }
    return { ok: true };
  } catch (error) {
    logger.error(`[bios] install failed for ${system}:`, error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "install_failed",
    };
  }
}
