import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import axios from "axios";
import { findExecutableOnPath } from "../launcher-binary";
import { findRetroArchCorePath, LINUX_RETRO_CORES } from "./retroarch-linux";
import { emulatorUserPaths } from "./emulator-user-paths";

export const RETROARCH_FLATPAK_ID = "org.libretro.RetroArch";
export const RETROARCH_FLATPAK_OPTION_ID = "ralibretro-linux-flatpak-user";
export const RETROARCH_FLATPAK_REF =
  "https://dl.flathub.org/repo/appstream/org.libretro.RetroArch.flatpakref";
const runFile = promisify(execFile);
const allowedCores = new Set(Object.values(LINUX_RETRO_CORES));

export function linuxRetroArchInstallPlan(
  platform = process.platform,
  arch = process.arch
) {
  if (platform !== "linux")
    throw new Error("Native RetroArch provisioning is Linux-only.");
  const flatpakArch =
    arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  if (!flatpakArch)
    throw new Error(
      `No supported RetroArch core build for Linux ${arch}. Install a matching native RetroArch build manually.`
    );
  return {
    arch: flatpakArch,
    args: [
      "install",
      "--user",
      "--noninteractive",
      "--assumeyes",
      `--arch=${flatpakArch}`,
      "--from",
      RETROARCH_FLATPAK_REF,
    ],
  };
}

export function linuxRetroCoreUrl(core: string, arch: string) {
  if (!allowedCores.has(core) || !["x86_64", "aarch64"].includes(arch))
    throw new Error("Unsupported libretro core or architecture.");
  return `https://buildbot.libretro.com/nightly/linux/${arch}/latest/${core}.so.zip`;
}

export function validateLinuxRetroCore(bytes: Uint8Array, arch: string) {
  const buffer = Buffer.from(bytes);
  const machine = arch === "x86_64" ? 62 : arch === "aarch64" ? 183 : null;
  if (
    !machine ||
    buffer.length < 64 ||
    buffer.readUInt32BE(0) !== 0x7f454c46 ||
    buffer[4] !== 2 ||
    buffer[5] !== 1 ||
    buffer.readUInt16LE(16) !== 3 ||
    buffer.readUInt16LE(18) !== machine
  ) {
    throw new Error(
      `The libretro core is not a valid ${arch} Linux shared library. The existing core was not replaced.`
    );
  }
}

export function validateLinuxRetroCoreArchive(
  entries: readonly string[],
  core: string
) {
  if (
    !allowedCores.has(core) ||
    entries.length !== 1 ||
    entries[0] !== `${core}.so`
  ) {
    throw new Error(
      "The core archive contained unexpected paths or files; nothing was extracted."
    );
  }
}

export interface CoreArchiveTools {
  listFiles: (file: string) => Promise<string[]>;
  extractFile: (options: {
    filePath: string;
    outputPath: string;
  }) => Promise<{ success: boolean; extractedFiles: string[] }>;
}

/** Official-updater source trust (HTTPS), archive integrity via 7-Zip and exact
 * ELF architecture verification. These rolling upstream builds are NOT claimed
 * to be pinned/checksum-authenticated releases. Existing user cores stay intact. */
export async function installLinuxRetroCore(
  directory: string,
  core: string,
  arch: string,
  archiveTools: CoreArchiveTools,
  download = async (url: string, destination: string) => {
    const { data } = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 60_000,
      maxRedirects: 0,
      maxContentLength: 64 * 1024 * 1024,
    });
    await fs.promises.writeFile(destination, Buffer.from(data), {
      flag: "wx",
      mode: 0o600,
    });
  }
) {
  const url = linuxRetroCoreUrl(core, arch);
  const destination = path.join(directory, `${core}.so`);
  await fs.promises.mkdir(directory, { recursive: true });
  try {
    const existing = await fs.promises.lstat(destination);
    if (!existing.isFile() || existing.size > 128 * 1024 * 1024)
      throw new Error(
        `The core location is occupied or oversized: ${core}.so. Move that entry manually and retry; it was not replaced.`
      );
    validateLinuxRetroCore(await fs.promises.readFile(destination), arch);
    return destination;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const staging = await fs.promises.mkdtemp(
    path.join(directory, ".gamehub-core-")
  );
  if (
    path.dirname(path.resolve(staging)) !== path.resolve(directory) ||
    !path.basename(staging).startsWith(".gamehub-core-")
  )
    throw new Error("Unsafe core staging cleanup path.");
  try {
    const archive = path.join(staging, "download.zip");
    await download(url, archive);
    validateLinuxRetroCoreArchive(await archiveTools.listFiles(archive), core);
    const result = await archiveTools.extractFile({
      filePath: archive,
      outputPath: staging,
    });
    if (!result.success) throw new Error(`Could not extract ${core}.so`);
    const extracted = path.join(staging, `${core}.so`);
    const stat = await fs.promises.lstat(extracted);
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024)
      throw new Error(
        "Core extraction did not produce a bounded regular file."
      );
    validateLinuxRetroCore(await fs.promises.readFile(extracted), arch);
    await fs.promises.chmod(extracted, 0o644);
    // Atomic exclusive publication: never overwrite a concurrently-created
    // user core, and never publish a partially downloaded/extracted library.
    await fs.promises.link(extracted, destination);
    return destination;
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

export async function provisionLinuxRetroArch({
  archiveTools,
  onStatus,
}: {
  archiveTools: CoreArchiveTools;
  onStatus: (message: string) => void;
}) {
  const plan = linuxRetroArchInstallPlan();
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error(
      "Run GameHub as your normal user to install RetroArch. Root installation is not used."
    );
  }
  const flatpak = findExecutableOnPath("flatpak");
  if (!flatpak)
    throw new Error(
      "Flatpak is not installed. Install Flatpak using your distribution's software manager, then retry, or select an existing native RetroArch executable."
    );
  onStatus("Installing the official RetroArch Flatpak for your user account…");
  try {
    await runFile(flatpak, plan.args, {
      timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
  } catch (error) {
    throw new Error(
      "RetroArch Flatpak installation did not complete. Check your connection and user Flatpak configuration, then retry. No administrator command or permission override was used.",
      { cause: error }
    );
  }
  const dataHome =
    process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
      ? process.env.XDG_DATA_HOME
      : path.join(os.homedir(), ".local", "share");
  const executable = path.join(
    dataHome,
    "flatpak",
    "exports",
    "bin",
    RETROARCH_FLATPAK_ID
  );
  try {
    await fs.promises.access(executable, fs.constants.X_OK);
  } catch {
    throw new Error(
      "RetroArch was installed, but its user Flatpak launcher was not found. Restart GameHub after completing Flatpak setup, then use Detect emulator."
    );
  }
  const cores = path.join(
    emulatorUserPaths("ralibretro", path.dirname(executable)).config,
    "cores"
  );
  for (const core of allowedCores) {
    onStatus(`Preparing ${core}.so for ${plan.arch}…`);
    try {
      await installLinuxRetroCore(cores, core, plan.arch, archiveTools);
    } catch (error) {
      throw new Error(
        `RetroArch is installed, but ${core}.so could not be prepared: ${error instanceof Error ? error.message : String(error)} Retry setup, or install the matching core in RetroArch's Online Updater → Core Downloader. Existing cores and saves were preserved.`
      );
    }
  }
  const validatedPaths = new Set<string>();
  for (const system of Object.keys(LINUX_RETRO_CORES)) {
    const selected = findRetroArchCorePath(path.dirname(executable), system);
    if (!selected)
      throw new Error(
        `RetroArch's configured core directory has no usable ${system} core. Review the core directory in RetroArch settings.`
      );
    if (validatedPaths.has(selected)) continue;
    validatedPaths.add(selected);
    const stat = await fs.promises.stat(selected);
    if (stat.size > 128 * 1024 * 1024)
      throw new Error(
        "A configured RetroArch core is unexpectedly large; it was preserved and setup stopped."
      );
    validateLinuxRetroCore(await fs.promises.readFile(selected), plan.arch);
  }
  return {
    executablePath: executable,
    coreDirectory: cores,
    coreCount: allowedCores.size,
  };
}
