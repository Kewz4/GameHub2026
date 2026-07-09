import { app } from "electron";
import { execFile } from "node:child_process";
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
} from "node:fs";
import path from "node:path";
import os from "node:os";
import * as tar from "tar";

import type {
  GameShop,
  InstalledMod,
  ModInstallPrep,
  ModManagerStatus,
  ModOptionGroup,
} from "@types";
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

/** Path to the patched UKMM binary bundled with the app (resources dir). */
const bundledUkmmPath = (): string => {
  const name = isWindows ? "ukmm.exe" : "ukmm";
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(emulatorsInstallPath, "..", "..", "binaries", name);
};

/**
 * Make sure a WRITABLE copy of the *patched* bundled UKMM binary is in place.
 *
 * UKMM runs in `--portable` mode (config + data next to the exe), which can't
 * live in the read-only resources dir, so we copy the bundled binary into the
 * writable emulators dir. Crucially we OVERWRITE any binary already there whose
 * size differs from the bundled one: older builds *downloaded* the stock,
 * unpatched UKMM (which has no `install-bnp` subcommand and falls back to its
 * GUI), and that stale copy must be replaced with our patched build. A stamp
 * file records the provisioned size so we only re-copy when it actually changes.
 */
export const ensureUkmm = (): boolean => {
  const paths = ukmmPaths();
  const bundled = bundledUkmmPath();
  if (!existsSync(bundled)) {
    // No bundled binary (non-Windows, or a build where the Rust compile was
    // skipped). Fall back to whatever is already provisioned, if anything.
    if (existsSync(paths.exe)) return true;
    logger.warn(`[ukmm] bundled binary missing at ${bundled}`);
    return false;
  }

  const bundledSize = (() => {
    try {
      return statSync(bundled).size;
    } catch {
      return -1;
    }
  })();
  const stampFile = path.join(paths.installDir, ".ukmm-stamp");
  const currentStamp = (() => {
    try {
      return Number(readFileSync(stampFile, "utf-8").trim());
    } catch {
      return NaN;
    }
  })();

  // Already the right (patched) binary? Nothing to do.
  if (existsSync(paths.exe) && currentStamp === bundledSize) return true;

  try {
    mkdirSync(paths.installDir, { recursive: true });
    // Overwrite any stale/unpatched binary with the bundled patched one.
    copyFileSync(bundled, paths.exe);
    if (!isWindows) chmodSync(paths.exe, 0o755);
    writeFileSync(stampFile, String(bundledSize), "utf-8");
    mkdirSync(paths.configDir, { recursive: true });
    mkdirSync(paths.downloadDir, { recursive: true });
    logger.log(
      `[ukmm] provisioned patched binary → ${paths.exe} (size ${bundledSize})`
    );
    return true;
  } catch (err) {
    // If the copy failed because the old exe is locked/running, fall back to it.
    if (existsSync(paths.exe)) {
      logger.warn("[ukmm] couldn't replace existing binary, using current", err);
      return true;
    }
    logger.error("[ukmm] couldn't provision bundled binary", err);
    return false;
  }
};

export const isUkmmInstalled = (): boolean =>
  existsSync(ukmmPaths().exe) || existsSync(bundledUkmmPath());

/** Kept for the existing IPC event: provisions the bundled binary (no download). */
export const installUkmm = async (): Promise<{
  ok: boolean;
  reason?: string;
}> =>
  ensureUkmm()
    ? { ok: true }
    : { ok: false, reason: "UKMM binary isn't bundled with this build" };

const resolveExe = (): string | null => {
  ensureUkmm();
  const paths = ukmmPaths();
  return existsSync(paths.exe) ? paths.exe : null;
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
  // whose update/DLC folder is nested is still found — without walking a drive.
  // A folder matches if its meta.xml title id matches, OR (fallback) its NAME
  // hints at the content type — loose Minerva/No-Intro dumps are named like
  // "...(Update) (v208)" / "...(DLC)" and may lack a meta.xml.
  const findLooseContent = (high: string, nameHints: string[]): string | null => {
    const queue: { dir: string; depth: number }[] = searchRoots.map((dir) => ({
      dir,
      depth: 0,
    }));
    const seen = new Set<string>();
    let visited = 0;
    let nameMatch: string | null = null;
    while (queue.length && visited < 800) {
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
        const c = path.join(child, "content");
        const tid = readMetaTitleId(child);
        // Strongest signal: matching title id in meta.xml.
        if (tid && tid.startsWith(high) && tid.endsWith(low) && existsSync(c)) {
          return c;
        }
        // Fallback: name hint (only when the folder has no conflicting title id
        // and actually holds a content dir). Remember but keep searching for a
        // title-id match, which wins.
        if (
          !nameMatch &&
          !tid &&
          existsSync(c) &&
          nameHints.some((h) => name.toLowerCase().includes(h))
        ) {
          nameMatch = c;
        }
        if (depth < 2) queue.push({ dir: child, depth: depth + 1 });
      }
    }
    return nameMatch;
  };

  const updateDir = existsSync(mlcContent(UPDATE))
    ? mlcContent(UPDATE)
    : findLooseContent(UPDATE, ["update", "(upd", " upd", "v208", "v1.5", "v1_5"]);
  const aocContent = existsSync(mlcContent(DLC))
    ? mlcContent(DLC)
    : findLooseContent(DLC, ["(dlc", " dlc", "aoc"]);
  // UKMM's Unpacked dump expects aoc_dir to hold Pack/AocMainField.pack, which
  // on a Cemu dump lives under content/0010 — append it when present.
  const aocDir =
    aocContent && existsSync(path.join(aocContent, "0010"))
      ? path.join(aocContent, "0010")
      : aocContent;

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
    // CRITICAL: the Endian enum is serde-renamed — Wii U => "Wii U" (NOT "Big").
    // Any other value fails to deserialize and silently voids the ENTIRE
    // wiiu_config, which is exactly the "No config for current platform" error.
    '    endian: "Wii U"',
  ];

  const yaml = [
    "current_mode: WiiU",
    "system_7z: true",
    `storage_dir: ${yamlPath(storage)}`,
    // enum is None|Stable|Beta — "Never" silently resets settings to default.
    "check_updates: None",
    "show_changelog: false",
    "last_version: null",
    "wiiu_config:",
    "  language: USen",
    "  profile: Default",
    ...dumpLines,
    "  deploy_config:",
    `    output: ${yamlPath(output)}`,
    "    method: HardLink",
    "    auto: true",
    "    cemu_rules: true",
    "    executable: null",
    "    layout: WithName",
    "switch_config: null",
    "lang: English",
    "",
  ].join("\n");

  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(paths.settingsFile, yaml, "utf-8");
};

/**
 * One-time (idempotent) setup: write settings.yml for this BOTW game + Cemu.
 * We deliberately do NOT run `ukmm mode wiiu` — that command re-serializes the
 * settings from whatever UKMM parsed, so if the file has ANY unparseable field
 * UKMM overwrites it with stripped defaults (dropping wiiu_config). We set
 * `current_mode: WiiU` directly in the file instead.
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

// ── Headless BNP install (extract → choose options → UKMM install-bnp) ────────

interface BnpStaging {
  bnpPath: string;
  tempDir: string;
  meta: { gbModId: number; name: string; thumbnailUrl: string | null };
}
const bnpStagings = new Map<string, BnpStaging>();
let bnpStagingSeq = 0;

/** Locate the archive subtree that holds the mod (content/aoc/rules/info). */
const findBnpRoot = (extractDir: string): string => {
  const isRoot = (dir: string): boolean =>
    existsSync(path.join(dir, "content")) ||
    existsSync(path.join(dir, "aoc")) ||
    existsSync(path.join(dir, "rules.txt")) ||
    existsSync(path.join(dir, "info.json"));
  if (isRoot(extractDir)) return extractDir;
  let cur = extractDir;
  for (let depth = 0; depth < 4; depth++) {
    let dirs: string[];
    try {
      dirs = readdirSync(cur).filter((e) => {
        try {
          return statSync(path.join(cur, e)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      break;
    }
    if (dirs.length === 1) {
      cur = path.join(cur, dirs[0]);
      if (isRoot(cur)) return cur;
    } else break;
  }
  return extractDir;
};

/** Parse a BNP's info.json options into ModOptionGroup[] (single/multi). */
const parseBnpOptions = (root: string): ModOptionGroup[] => {
  const infoPath = path.join(root, "info.json");
  if (!existsSync(infoPath)) return [];
  let info: any;
  try {
    info = JSON.parse(readFileSync(infoPath, "utf-8"));
  } catch {
    return [];
  }
  const opts = info?.options;
  if (!opts) return [];
  const mapGroup = (g: any, type: "single" | "multi"): ModOptionGroup => ({
    name: g?.name ?? "Options",
    description: g?.desc ?? "",
    type,
    required: Boolean(g?.required),
    options: (g?.options ?? [])
      .filter((o: any) => o?.folder)
      .map((o: any) => ({
        name: o?.name ?? o?.folder,
        description: o?.desc ?? "",
        folder: o.folder as string,
      })),
  });
  const groups: ModOptionGroup[] = [];
  for (const g of opts.single ?? []) groups.push(mapGroup(g, "single"));
  for (const g of opts.multi ?? []) groups.push(mapGroup(g, "multi"));
  return groups.filter((g) => g.options.length > 0);
};

/**
 * Stage a downloaded mod for install: extract it just enough to read its
 * info.json options, and report whether the user must choose options. The
 * caller either finalizes immediately (no options) or shows the chooser and
 * calls `finalizeBnpInstall` with the picked option folders.
 */
export const prepareBnpInstall = async (
  filePath: string,
  meta: { gbModId: number; name: string; thumbnailUrl: string | null }
): Promise<ModInstallPrep> => {
  const tempDir = path.join(os.tmpdir(), `gh-bnp-${Date.now()}-${++bnpStagingSeq}`);
  mkdirSync(tempDir, { recursive: true });
  try {
    const extraction = await SevenZip.extractFile({ filePath, outputPath: tempDir });
    if (!extraction.success) {
      rmSync(tempDir, { recursive: true, force: true });
      return { ok: false, reason: "Couldn't read the mod archive" };
    }
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    return { ok: false, reason: `Couldn't read the mod: ${err}` };
  }

  const root = findBnpRoot(tempDir);
  const stagingId = `bnp-${Date.now()}-${bnpStagingSeq}`;
  bnpStagings.set(stagingId, { bnpPath: filePath, tempDir, meta });

  const optionGroups = parseBnpOptions(root);
  if (optionGroups.length > 0) {
    return { ok: true, needsOptions: true, stagingId, name: meta.name, optionGroups };
  }
  return { ok: true, stagingId };
};

const cleanupBnpStaging = (stagingId: string): void => {
  const s = bnpStagings.get(stagingId);
  if (s) {
    try {
      rmSync(s.tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    // Remove the downloaded .bnp too (UKMM has already consumed it by now).
    try {
      if (existsSync(s.bnpPath)) unlinkSync(s.bnpPath);
    } catch {
      /* ignore */
    }
    bnpStagings.delete(stagingId);
  }
};

/** Discard a staged install the user backed out of. */
export const cancelBnpInstall = (stagingId: string): void =>
  cleanupBnpStaging(stagingId);

/**
 * Finalize a staged install: configure UKMM for this game + Cemu, then run the
 * patched `install-bnp` headlessly (converting the .bnp, applying the chosen
 * options, merging + rebuilding the RSTB, and deploying into Cemu's
 * graphicPacks). `selectedFolders` are the info.json option folders the user
 * picked (empty for optionless mods).
 */
export const finalizeBnpInstall = async (
  shop: GameShop,
  objectId: string,
  stagingId: string,
  selectedFolders: string[]
): Promise<{ ok: boolean; reason?: string }> => {
  const staging = bnpStagings.get(stagingId);
  if (!staging) {
    return { ok: false, reason: "This install session expired — try again." };
  }
  if (!ensureUkmm()) {
    cleanupBnpStaging(stagingId);
    return { ok: false, reason: "UKMM isn't available in this build" };
  }

  const cemu = await resolveCemuGamePaths(shop, objectId);
  if (!cemu || !cemu.gameContentDir) {
    cleanupBnpStaging(stagingId);
    return { ok: false, reason: "Couldn't locate this game's files in Cemu." };
  }

  const configured = await configureUkmm(shop, objectId);
  if (!configured.ok) {
    cleanupBnpStaging(stagingId);
    return configured;
  }

  const args = ["install-bnp", staging.bnpPath];
  if (selectedFolders.length > 0) {
    args.push("--options", JSON.stringify(selectedFolders));
  }
  const res = await runUkmm(args, true); // -D deploy so Cemu loads it

  cleanupBnpStaging(stagingId);
  if (!res.ok) {
    // Many BOTW mods reference update-layer files; if the update dump is absent
    // that's the usual cause of a conversion/merge failure — point the user to it.
    const hint = !cemu.updateDir
      ? " This mod likely needs the game Update (v1.5.0 / v208) — install it in " +
        "Cemu or place the update folder next to the game."
      : "";
    return {
      ok: false,
      reason: (res.stderr || "UKMM failed to install the mod") + hint,
    };
  }

  const list = await getInstalled(shop, objectId);
  list.push({
    gbModId: staging.meta.gbModId,
    name: staging.meta.name,
    fileName: path.basename(staging.bnpPath),
    thumbnailUrl: staging.meta.thumbnailUrl,
    installedAt: new Date().toISOString(),
    packRulesId: ukmmPackRulesId(),
  });
  await installedModsSublevel.put(modsKey(shop, objectId), list);
  // Ensure the merged UKMM pack is active so Cemu loads it.
  await setGraphicPackEnabled(ukmmPackRulesId(), true).catch(() => {});
  return { ok: true };
};

/** Uninstall a tracked mod by its position (matches UKMM's load order). */
export const uninstallMod = async (
  shop: GameShop,
  objectId: string,
  index: number
): Promise<{ ok: boolean; reason?: string }> => {
  if (!ensureUkmm()) return { ok: false, reason: "UKMM isn't available" };
  await configureUkmm(shop, objectId);
  const res = await runUkmm(["uninstall", String(index)], true);

  const list = await getInstalled(shop, objectId);
  // "Mod N does not exist" means our tracking is out of sync with UKMM's actual
  // storage (e.g. entries left over from an older build whose install never
  // reached UKMM). Treat it as already-gone and drop the phantom entry so the
  // user can clear the list instead of hitting the same error forever.
  if (!res.ok && !/does not exist/i.test(res.stderr)) {
    return { ok: false, reason: res.stderr || "UKMM failed to uninstall" };
  }
  if (index >= 0 && index < list.length) list.splice(index, 1);
  await installedModsSublevel.put(modsKey(shop, objectId), list);
  return { ok: true };
};

/**
 * Reset all mod tracking + UKMM storage for a clean slate — clears our tracked
 * list, wipes UKMM's installed mods/profiles, and disables the deployed pack.
 * Used to recover from a corrupt/desynced state.
 */
export const resetMods = async (
  shop: GameShop,
  objectId: string
): Promise<{ ok: boolean; reason?: string }> => {
  try {
    const paths = ukmmPaths();
    const storage = path.join(paths.installDir, "config", "storage");
    if (existsSync(storage)) rmSync(storage, { recursive: true, force: true });
    await installedModsSublevel.put(modsKey(shop, objectId), []);
    await setGraphicPackEnabled(ukmmPackRulesId(), false).catch(() => {});
    logger.log("[ukmm] reset mods (cleared storage + tracking)");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
};

/** The master mods switch: enable/disable the deployed UKMM Cemu graphic pack. */
export const setModsEnabled = async (
  _shop: GameShop,
  _objectId: string,
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

  // UKMM merges every installed mod into ONE deployed Cemu graphic pack
  // (BreathOfTheWild_UKMM); "mods enabled" means that pack is active in
  // settings.xml.
  const installed = await getInstalled(shop, objectId);
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
    // The patched UKMM binary is bundled with the app, so mod support is ready
    // whenever Cemu is set up — no separate download step.
    ukmmInstalled: ensureUkmm(),
    cemuInstalled,
    modsEnabled,
    installed,
  };
};

export { ukmmPaths };
