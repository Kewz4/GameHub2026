import axios from "axios";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { GameShop, InstalledMod, ModManagerStatus } from "@types";
import { emulatorsInstallPath } from "@main/constants";
import { gamesSublevel, levelKeys, installedModsSublevel } from "@main/level";
import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { getEmulatorConfig } from "./emulators-repository";
import { cemuDataDir } from "./emulator-portable";
import { resolveWiiuTitleId, setGraphicPackEnabled } from "./cemu-graphic-packs";

const execFileAsync = promisify(execFile);

/**
 * Headless UKMM (U-King Mod Manager) integration for Breath of the Wild on
 * Cemu. UKMM is a single Rust binary with a CLI (install/uninstall/mode/deploy).
 * We run it in `--portable` mode so all its data lives next to our copy, set it
 * to Wii U mode, and configure it to auto-deploy the merged mod into Cemu's
 * graphicPacks as `BreathOfTheWild_UKMM` (a rules.txt graphic pack Cemu loads).
 *
 * BOTW's Wii U base title id is 00050000101c9400; the update lives under
 * 0005000e101c9400 and DLC under 0005000c101c9400 in Cemu's mlc01.
 */

const isWindows = process.platform === "win32";
const UKMM_RELEASE_API =
  "https://api.github.com/repos/NiceneNerd/ukmm/releases/latest";

// The deployed Cemu graphic-pack folder + the rules.txt path (relative to the
// Cemu data dir) that acts as the master "mods enabled" switch.
const UKMM_PACK_DIR = "BreathOfTheWild_UKMM";
const ukmmPackRulesId = () =>
  `graphicPacks/${UKMM_PACK_DIR}/rules.txt`;

interface UkmmPaths {
  installDir: string;
  exe: string;
  configDir: string;
  settingsFile: string;
  downloadDir: string;
}

const ukmmPaths = (): UkmmPaths => {
  const installDir = path.join(emulatorsInstallPath, "ukmm");
  return {
    installDir,
    exe: path.join(installDir, isWindows ? "ukmm.exe" : "ukmm"),
    configDir: path.join(installDir, "config"),
    settingsFile: path.join(installDir, "config", "settings.yml"),
    downloadDir: path.join(installDir, "downloads"),
  };
};

export const isUkmmInstalled = (): boolean => existsSync(ukmmPaths().exe);

/** Download + extract the latest UKMM release for this OS. */
export const installUkmm = async (): Promise<{
  ok: boolean;
  reason?: string;
}> => {
  const paths = ukmmPaths();
  try {
    const release = await axios.get<{
      assets: { name: string; browser_download_url: string }[];
    }>(UKMM_RELEASE_API, {
      headers: { "User-Agent": "GameHub", Accept: "application/vnd.github+json" },
      timeout: 30_000,
    });
    const assets = release.data.assets ?? [];
    const pattern = isWindows
      ? /windows|win|\.zip$/i
      : /linux|\.tar|\.appimage$/i;
    const asset =
      assets.find((a) => pattern.test(a.name)) ??
      assets.find((a) => /\.(zip|7z|tar\.\w+|tar)$/i.test(a.name));
    if (!asset) return { ok: false, reason: "No UKMM asset for this platform" };

    mkdirSync(paths.installDir, { recursive: true });
    const archive = path.join(paths.installDir, asset.name);
    const resp = await axios.get<NodeJS.ReadableStream>(
      asset.browser_download_url,
      {
        responseType: "stream",
        timeout: 0,
        maxRedirects: 5,
        headers: { "User-Agent": "GameHub" },
      }
    );
    await pipeline(resp.data, createWriteStream(archive));

    const extraction = await SevenZip.extractFile({
      filePath: archive,
      outputPath: paths.installDir,
    });
    rmSync(archive, { force: true });
    if (!extraction.success) {
      return { ok: false, reason: "Failed to extract UKMM" };
    }

    // The archive may nest the exe in a subfolder — locate + hoist a reference.
    if (!existsSync(paths.exe)) {
      const found = findExe(paths.installDir);
      if (!found) return { ok: false, reason: "UKMM executable not found" };
      // Symlink/copy the found exe to the expected path isn't reliable across
      // platforms; instead remember its dir by writing a tiny pointer.
      writeFileSync(
        path.join(paths.installDir, ".ukmm-exe"),
        found,
        "utf-8"
      );
    }
    if (!isWindows && existsSync(paths.exe)) chmodSync(paths.exe, 0o755);

    mkdirSync(paths.configDir, { recursive: true });
    mkdirSync(paths.downloadDir, { recursive: true });
    logger.log("[ukmm] installed");
    return { ok: true };
  } catch (err) {
    logger.error("[ukmm] install failed", err);
    return { ok: false, reason: String(err) };
  }
};

const findExe = (root: string): string | null => {
  const target = isWindows ? "ukmm.exe" : "ukmm";
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) stack.push(full);
      else if (e.toLowerCase() === target) return full;
    }
  }
  return null;
};

const resolveExe = (): string | null => {
  const paths = ukmmPaths();
  if (existsSync(paths.exe)) return paths.exe;
  const pointer = path.join(paths.installDir, ".ukmm-exe");
  if (existsSync(pointer)) {
    try {
      const p = readFileSync(pointer, "utf-8").trim();
      if (p && existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
};

/** Run a UKMM CLI command in portable mode. `-D` auto-deploys after. */
const runUkmm = async (
  args: string[],
  deploy = false
): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
  const exe = resolveExe();
  if (!exe) return { ok: false, stdout: "", stderr: "UKMM not installed" };
  const full = ["--portable", ...(deploy ? ["--deploy"] : []), ...args];
  try {
    const { stdout, stderr } = await execFileAsync(exe, full, {
      cwd: path.dirname(exe),
      timeout: 300_000,
      windowsHide: true,
    });
    return { ok: true, stdout, stderr };
  } catch (err: any) {
    logger.error(`[ukmm] command failed: ${full.join(" ")}`, err);
    return {
      ok: false,
      stdout: err?.stdout ?? "",
      stderr: err?.stderr ?? String(err),
    };
  }
};

// ── Cemu / game path resolution ──────────────────────────────────────────────

interface CemuGamePaths {
  cemuDir: string;
  gameContentDir: string | null;
  updateDir: string | null;
  aocDir: string | null;
  titleLow: string; // 8-hex low id, e.g. 101c9400
  gameDir: string | null;
}

const resolveCemuGamePaths = async (
  shop: GameShop,
  objectId: string
): Promise<CemuGamePaths | null> => {
  const config = await getEmulatorConfig("wiiu").catch(() => null);
  if (config?.binary !== "cemu" || !config.executablePath) return null;
  const cemuDir = cemuDataDir(path.dirname(config.executablePath));

  const titleId = await resolveWiiuTitleId(shop, objectId);
  const titleLow = titleId ? titleId.slice(8) : "101c9400"; // BOTW default

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  // The base game folder: the parent of its content/code/meta.
  const disc = game?.selectedDiscPath ?? game?.discs?.[0]?.path ?? null;
  let gameDir: string | null = null;
  let gameContentDir: string | null = null;
  if (disc) {
    for (const base of [disc, path.dirname(disc), path.dirname(path.dirname(disc))]) {
      if (existsSync(path.join(base, "content"))) {
        gameDir = base;
        gameContentDir = path.join(base, "content");
        break;
      }
    }
  }

  // Update + DLC live in Cemu's mlc01 under the version-family title ids.
  const mlcTitle = (high: string) =>
    path.join(cemuDir, "mlc01", "usr", "title", high, titleLow, "content");
  const updateDir = existsSync(mlcTitle("0005000e"))
    ? mlcTitle("0005000e")
    : null;
  const aocBase = path.join(
    cemuDir,
    "mlc01",
    "usr",
    "title",
    "0005000c",
    titleLow,
    "content"
  );
  const aocDir = existsSync(aocBase) ? aocBase : null;

  return {
    cemuDir,
    gameContentDir,
    updateDir,
    aocDir,
    titleLow,
    gameDir,
  };
};

const yamlPath = (p: string): string => JSON.stringify(p.replace(/\\/g, "/"));

/**
 * Write UKMM's settings.yml for Wii U + Cemu deploy. The `dump` uses the
 * Unpacked resource reader (content/update/aoc dirs); deploy targets Cemu's
 * graphicPacks/BreathOfTheWild_UKMM with rules.txt so Cemu auto-loads it.
 */
const writeUkmmSettings = (paths: UkmmPaths, cemu: CemuGamePaths): void => {
  const storage = path.join(paths.installDir, "config", "storage");
  mkdirSync(storage, { recursive: true });
  const output = path.join(cemu.cemuDir, "graphicPacks", UKMM_PACK_DIR);

  const dumpLines = [
    "  dump:",
    "    bin_type: Nintendo",
    "    source:",
    '      type: "Unpacked"',
    `      host_path: ${yamlPath(cemu.gameDir ?? cemu.cemuDir)}`,
    cemu.gameContentDir
      ? `      content_dir: ${yamlPath(cemu.gameContentDir)}`
      : "      content_dir: null",
    cemu.updateDir
      ? `      update_dir: ${yamlPath(cemu.updateDir)}`
      : "      update_dir: null",
    cemu.aocDir ? `      aoc_dir: ${yamlPath(cemu.aocDir)}` : "      aoc_dir: null",
  ];

  const yaml = [
    "current_mode: WiiU",
    "system_7z: true",
    `storage_dir: ${yamlPath(storage)}`,
    "check_updates: Never",
    "show_changelog: false",
    "wiiu_config:",
    "  language: USen",
    "  profile: Default",
    ...dumpLines,
    "  deploy_config:",
    `    output: ${yamlPath(output)}`,
    "    method: HardLink",
    "    auto: true",
    "    cemu_rules: true",
    "    layout: WithName",
    "lang: English",
    "",
  ].join("\n");

  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(paths.settingsFile, yaml, "utf-8");
};

/**
 * One-time (idempotent) setup: write settings.yml for this BOTW game + Cemu,
 * and set UKMM to Wii U mode. Safe to call before each install.
 */
export const configureUkmm = async (
  shop: GameShop,
  objectId: string
): Promise<{ ok: boolean; reason?: string }> => {
  const cemu = await resolveCemuGamePaths(shop, objectId);
  if (!cemu) return { ok: false, reason: "Cemu is not set up for this game" };
  const paths = ukmmPaths();
  try {
    writeUkmmSettings(paths, cemu);
  } catch (err) {
    return { ok: false, reason: `Couldn't write UKMM settings: ${err}` };
  }
  await runUkmm(["mode", "wiiu"]);
  return { ok: true };
};

// ── Install / uninstall / status ─────────────────────────────────────────────

const modsKey = (shop: GameShop, objectId: string) =>
  levelKeys.game(shop, objectId);

const getInstalled = async (
  shop: GameShop,
  objectId: string
): Promise<InstalledMod[]> =>
  (await installedModsSublevel
    .get(modsKey(shop, objectId))
    .catch(() => null)) ?? [];

/** Install a mod from an already-downloaded file (.bnp/.zip) via UKMM. */
export const installModFromFile = async (
  shop: GameShop,
  objectId: string,
  filePath: string,
  meta: { gbModId: number; name: string; thumbnailUrl: string | null }
): Promise<{ ok: boolean; reason?: string }> => {
  await configureUkmm(shop, objectId);
  const res = await runUkmm(["install", filePath], true);
  if (!res.ok) {
    return {
      ok: false,
      reason: res.stderr || "UKMM failed to install the mod",
    };
  }
  const list = await getInstalled(shop, objectId);
  list.push({
    gbModId: meta.gbModId,
    name: meta.name,
    fileName: path.basename(filePath),
    thumbnailUrl: meta.thumbnailUrl,
    installedAt: new Date().toISOString(),
  });
  await installedModsSublevel.put(modsKey(shop, objectId), list);
  // Ensure the deployed pack is active so Cemu loads it.
  await setGraphicPackEnabled(ukmmPackRulesId(), true).catch(() => {});
  return { ok: true };
};

/** Uninstall a tracked mod by its position (matches UKMM's load order). */
export const uninstallMod = async (
  shop: GameShop,
  objectId: string,
  index: number
): Promise<{ ok: boolean; reason?: string }> => {
  const res = await runUkmm(["uninstall", String(index)], true);
  if (!res.ok) {
    return { ok: false, reason: res.stderr || "UKMM failed to uninstall" };
  }
  const list = await getInstalled(shop, objectId);
  if (index >= 0 && index < list.length) list.splice(index, 1);
  await installedModsSublevel.put(modsKey(shop, objectId), list);
  return { ok: true };
};

/** The master mods switch: enable/disable the deployed UKMM Cemu graphic pack. */
export const setModsEnabled = async (
  enabled: boolean
): Promise<{ ok: boolean }> => {
  const ok = await setGraphicPackEnabled(ukmmPackRulesId(), enabled).catch(
    () => false
  );
  return { ok };
};

export const getModStatus = async (
  shop: GameShop,
  objectId: string
): Promise<ModManagerStatus> => {
  const cemuConfig = await getEmulatorConfig("wiiu").catch(() => null);
  const cemuInstalled =
    cemuConfig?.binary === "cemu" && Boolean(cemuConfig.executablePath);

  // Read whether the UKMM pack is currently enabled in Cemu's settings.xml.
  let modsEnabled = false;
  try {
    const cemu = await resolveCemuGamePaths(shop, objectId);
    if (cemu) {
      const settingsFile = path.join(cemu.cemuDir, "settings.xml");
      if (existsSync(settingsFile)) {
        const xml = readFileSync(settingsFile, "utf-8");
        modsEnabled = xml.includes(ukmmPackRulesId());
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ukmmInstalled: isUkmmInstalled(),
    cemuInstalled,
    modsEnabled,
    installed: await getInstalled(shop, objectId),
  };
};

export { ukmmPaths };
