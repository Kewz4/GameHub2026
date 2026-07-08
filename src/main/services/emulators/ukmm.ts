import axios from "axios";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

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
const isMac = process.platform === "darwin";
const isArm = process.arch === "arm64";
const UKMM_RELEASE_API =
  "https://api.github.com/repos/NiceneNerd/ukmm/releases/latest";

/**
 * Pick the correct release asset for THIS OS + arch. UKMM ships per-target
 * archives (e.g. `ukmm-x86_64-pc-windows-msvc.zip`,
 * `ukmm-x86_64-unknown-linux-gnu.tar.xz`, `ukmm-aarch64-apple-darwin`) plus
 * `-update` binaries (raw PE/Mach-O auto-updater files — NOT archives; feeding
 * one to 7-Zip dumps its binary sections). We score by target triple and hard-
 * exclude `-update`. NB: the naive /win/ test matched "dar-WIN", which is how
 * the macOS updater got downloaded before.
 */
const pickUkmmAsset = (
  assets: { name: string; browser_download_url: string }[]
): { name: string; browser_download_url: string } | null => {
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n.includes("-update")) return -1; // never the updater binary
    if (isWindows) {
      if (n.includes("pc-windows") && n.endsWith(".zip")) return 100;
      if (n.includes("windows") && n.endsWith(".zip")) return 80;
      if (n.endsWith(".zip") && !n.includes("darwin") && !n.includes("linux"))
        return 40;
      return -1;
    }
    if (isMac) {
      if (!n.includes("apple-darwin")) return -1;
      return n.includes(isArm ? "aarch64" : "x86_64") ? 100 : 70;
    }
    // linux
    if (n.includes("linux")) {
      const archOk = n.includes(isArm ? "aarch64" : "x86_64");
      if (/\.(tar\.\w+|tar|zip|7z)$/i.test(n)) return archOk ? 100 : 70;
      if (n.endsWith(".appimage")) return archOk ? 60 : 40;
    }
    return -1;
  };
  let best: { name: string; browser_download_url: string } | null = null;
  let bestScore = 0;
  for (const a of assets) {
    const s = score(a.name);
    if (s > bestScore) {
      best = a;
      bestScore = s;
    }
  }
  return best;
};

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
    const asset = pickUkmmAsset(assets);
    if (!asset) {
      logger.error(
        "[ukmm] no matching asset. Available:",
        assets.map((a) => a.name)
      );
      return { ok: false, reason: "No UKMM asset for this platform" };
    }
    logger.log(
      `[ukmm] selected asset ${asset.name} for ${process.platform}/${process.arch}`
    );

    // Clean slate — a previous failed install may have left junk (e.g. the
    // Mach-O sections 7-Zip dumps from a raw `-update` binary).
    if (existsSync(paths.installDir)) {
      rmSync(paths.installDir, { recursive: true, force: true });
    }
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
  logger.log(`[ukmm] run: ukmm ${full.join(" ")}`);
  try {
    const { stdout, stderr } = await execFileAsync(exe, full, {
      cwd: path.dirname(exe),
      timeout: 300_000,
      windowsHide: true,
    });
    if (stdout?.trim()) logger.log(`[ukmm] stdout: ${stdout.trim()}`);
    if (stderr?.trim()) logger.warn(`[ukmm] stderr: ${stderr.trim()}`);
    return { ok: true, stdout, stderr };
  } catch (err: any) {
    const stderr = err?.stderr ?? String(err);
    logger.error(`[ukmm] command failed: ukmm ${full.join(" ")}\n${stderr}`);
    return { ok: false, stdout: err?.stdout ?? "", stderr };
  }
};

/**
 * Some mods can't be installed by the CLI: `.bnp` (legacy BCML) archives, and
 * mods that expose configuration options — both require UKMM's GUI. When we hit
 * those, open the file in UKMM's GUI so the user can finish the (one-click)
 * install there, and report a friendly message.
 */
const needsGuiInstall = (stderr: string): boolean =>
  /bnp files are not supported/i.test(stderr) ||
  /install(ed)? via the gui/i.test(stderr) ||
  /configuration options/i.test(stderr);

const openInUkmmGui = (fileOrUri: string): boolean => {
  const exe = resolveExe();
  if (!exe) return false;
  try {
    // UKMM's GUI fallback reads the mod path from std::env::args().nth(1) — the
    // FIRST arg — so the path (or bcml: URI) must come first. `--portable` is
    // detected by scanning ALL args, so it can safely follow.
    const child = spawn(exe, [fileOrUri, "--portable"], {
      cwd: path.dirname(exe),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    logger.log(`[ukmm] opened GUI to install ${path.basename(fileOrUri)}`);
    return true;
  } catch (err) {
    logger.error("[ukmm] failed to open GUI", err);
    return false;
  }
};

/**
 * Install a mod straight from a `bcml:` 1-click URI using UKMM's native
 * one-click handler (downloads + installs in the GUI). This is the most
 * reliable path for legacy BNP mods, which the CLI can't install.
 */
export const oneClickInstall = (bcmlUri: string): boolean =>
  openInUkmmGui(bcmlUri);

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

  const low = titleLow.toLowerCase();
  const BASE = "00050000";
  const UPDATE = "0005000e";
  const DLC = "0005000c";

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);

  // ── Base game: the loose folder we launch, else Cemu's mlc01 install ────────
  const disc = game?.selectedDiscPath ?? game?.discs?.[0]?.path ?? null;
  let gameDir: string | null = null;
  let gameContentDir: string | null = null;
  if (disc) {
    for (const base of [
      disc,
      path.dirname(disc),
      path.dirname(path.dirname(disc)),
    ]) {
      if (existsSync(path.join(base, "content"))) {
        gameDir = base;
        gameContentDir = path.join(base, "content");
        break;
      }
    }
  }
  const mlcContent = (high: string) =>
    path.join(cemuDir, "mlc01", "usr", "title", high, low, "content");
  if (!gameContentDir && existsSync(mlcContent(BASE))) {
    gameContentDir = mlcContent(BASE);
    gameDir = path.dirname(gameContentDir);
  }

  // ── Update + DLC: Cemu's mlc01 install first, then loose sibling folders ─────
  // (e.g. a Minerva download of base + update + DLC that hasn't been installed
  // into Cemu — the update/DLC sit next to the base game on disk).
  const searchRoots = Array.from(
    new Set(
      [
        gameDir ? path.dirname(gameDir) : null,
        gameDir ? path.dirname(path.dirname(gameDir)) : null,
        disc ? path.dirname(disc) : null,
      ].filter((r): r is string => Boolean(r))
    )
  );

  // Bounded BFS over the search roots (depth 2, capped) so a Minerva download
  // whose update/DLC folder is nested one level deep is still found — without
  // walking an entire drive.
  const findLooseContent = (high: string): string | null => {
    const queue: { dir: string; depth: number }[] = searchRoots.map((dir) => ({
      dir,
      depth: 0,
    }));
    const seen = new Set<string>();
    let visited = 0;
    while (queue.length && visited < 400) {
      const { dir, depth } = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);
      visited++;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const child = path.join(dir, name);
        try {
          if (!statSync(child).isDirectory()) continue;
        } catch {
          continue;
        }
        const tid = readMetaTitleId(child);
        if (tid && tid.startsWith(high) && tid.endsWith(low)) {
          const c = path.join(child, "content");
          if (existsSync(c)) return c;
        }
        if (depth < 1) queue.push({ dir: child, depth: depth + 1 });
      }
    }
    return null;
  };

  const updateDir = existsSync(mlcContent(UPDATE))
    ? mlcContent(UPDATE)
    : findLooseContent(UPDATE);
  const aocDir = existsSync(mlcContent(DLC))
    ? mlcContent(DLC)
    : findLooseContent(DLC);

  logger.log(
    `[ukmm] BOTW dump for ${shop}:${objectId} (title ${BASE}${low}) — ` +
      `base=${gameContentDir ?? "MISSING"} update=${updateDir ?? "MISSING"} dlc=${aocDir ?? "none"}`
  );

  return { cemuDir, gameContentDir, updateDir, aocDir, titleLow, gameDir };
};

/** Read the 16-hex Wii U title id from a folder's meta/meta.xml, lowercased. */
const readMetaTitleId = (dir: string): string | null => {
  try {
    const metaPath = path.join(dir, "meta", "meta.xml");
    if (!existsSync(metaPath)) return null;
    const xml = readFileSync(metaPath, "utf-8");
    const m = xml.match(/<title_id[^>]*>\s*([0-9a-fA-F]{16})\s*<\/title_id>/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
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
): Promise<{ ok: boolean; reason?: string; guiHandoff?: boolean }> => {
  await configureUkmm(shop, objectId);

  // A .bnp is just a 7z archive with a RomFS/graphic-pack structure
  // (content/ + rules.txt). UKMM's CLI rejects the `.bnp` EXTENSION but accepts
  // the identical archive as `.7z` (convert_gfx reads the content + rules.txt),
  // so install a .7z copy — fully headless, no GUI. Everything else installs
  // as-is.
  let installPath = filePath;
  let tempCopy: string | null = null;
  if (filePath.toLowerCase().endsWith(".bnp")) {
    tempCopy = filePath.replace(/\.bnp$/i, "") + ".7z";
    try {
      copyFileSync(filePath, tempCopy);
      installPath = tempCopy;
      logger.log(`[ukmm] installing .bnp as .7z: ${path.basename(tempCopy)}`);
    } catch (err) {
      logger.warn("[ukmm] couldn't copy .bnp to .7z, using original", err);
      tempCopy = null;
    }
  }

  const res = await runUkmm(["install", installPath], true);
  if (tempCopy) {
    try {
      unlinkSync(tempCopy);
    } catch {
      /* best effort */
    }
  }

  if (!res.ok) {
    // Mods with configuration options (or anything else the CLI can't take)
    // still need UKMM's GUI — hand off so the user can finish there.
    if (needsGuiInstall(res.stderr)) {
      const opened = openInUkmmGui(filePath);
      return {
        ok: false,
        guiHandoff: opened,
        reason: opened
          ? "This mod has selectable options — opened in UKMM to choose them."
          : "This mod must be installed via the UKMM app.",
      };
    }
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

// ── Export / import a modpack ────────────────────────────────────────────────

/**
 * Export the whole UKMM mod set (storage: installed mods + load order) plus our
 * GameBanana tracking into a single `.ghmods` archive the user can share. A
 * friend imports it to reproduce the exact modpack.
 */
export const exportModpack = async (
  shop: GameShop,
  objectId: string,
  destPath: string
): Promise<{ ok: boolean; reason?: string }> => {
  const paths = ukmmPaths();
  const configDir = path.join(paths.installDir, "config");
  const storage = path.join(configDir, "storage");
  if (!existsSync(storage)) {
    return { ok: false, reason: "No mods installed to export" };
  }
  try {
    const installed = await getInstalled(shop, objectId);
    const manifest = path.join(configDir, "gamehub-modpack.json");
    writeFileSync(manifest, JSON.stringify({ installed }), "utf-8");
    await tar.create(
      { gzip: true, file: destPath, cwd: configDir },
      ["storage", "gamehub-modpack.json"]
    );
    try {
      unlinkSync(manifest);
    } catch {
      /* ignore */
    }
    logger.log(`[ukmm] exported modpack → ${destPath}`);
    return { ok: true };
  } catch (err) {
    logger.error("[ukmm] export failed", err);
    return { ok: false, reason: String(err) };
  }
};

/** Import a `.ghmods` modpack: replace the mod set, then remerge + deploy. */
export const importModpack = async (
  shop: GameShop,
  objectId: string,
  srcPath: string
): Promise<{ ok: boolean; reason?: string }> => {
  const paths = ukmmPaths();
  const configDir = path.join(paths.installDir, "config");
  try {
    mkdirSync(configDir, { recursive: true });
    // Replace the existing storage so the modpack is reproduced exactly.
    const storage = path.join(configDir, "storage");
    if (existsSync(storage)) rmSync(storage, { recursive: true, force: true });
    await tar.x({ file: srcPath, cwd: configDir });

    const manifest = path.join(configDir, "gamehub-modpack.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf-8"));
        if (Array.isArray(parsed?.installed)) {
          await installedModsSublevel.put(
            modsKey(shop, objectId),
            parsed.installed
          );
        }
      } catch {
        /* ignore malformed manifest */
      }
      try {
        unlinkSync(manifest);
      } catch {
        /* ignore */
      }
    }

    await configureUkmm(shop, objectId);
    await runUkmm(["remerge"], true); // rebuild the merge + deploy to Cemu
    await setGraphicPackEnabled(ukmmPackRulesId(), true).catch(() => {});
    logger.log("[ukmm] imported modpack + redeployed");
    return { ok: true };
  } catch (err) {
    logger.error("[ukmm] import failed", err);
    return { ok: false, reason: String(err) };
  }
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
