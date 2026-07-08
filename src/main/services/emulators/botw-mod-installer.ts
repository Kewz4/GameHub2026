import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

import type {
  GameShop,
  InstalledMod,
  ModInstallPrep,
  ModOptionGroup,
} from "@types";
import { levelKeys, installedModsSublevel } from "@main/level";
import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { getEmulatorConfig } from "./emulators-repository";
import { cemuDataDir } from "./emulator-portable";
import {
  resolveWiiuTitleId,
  setGraphicPackEnabled,
} from "./cemu-graphic-packs";

/**
 * Fully headless BOTW mod installer. A GameBanana `.bnp` (BCML) mod is really a
 * 7-Zip archive laid out as a Cemu graphic pack: a `content/` (RomFS) folder,
 * optional `aoc/` (DLC), an optional `rules.txt` (Cemu graphic-pack Definition)
 * and, for configurable mods, an `info.json` describing selectable option groups
 * whose files live under `options/<folder>/`.
 *
 * Rather than shell out to UKMM's fragile CLI (which panics on some SARC files,
 * rejects the `.bnp` extension, and pops its GUI for option mods), we extract
 * the BNP ourselves, let the user pick options inside GameHub, merge the chosen
 * option folders over the base content, and deploy the result straight into
 * Cemu's `graphicPacks/GameHubMods/<mod>/` as a content-redirection graphic pack
 * (`rules.txt` version 7 + `content/`+`aoc/`), then flip it on in settings.xml.
 * No terminal, no GUI — ever.
 */

// BOTW Wii U title ids (USA/JP/EU) so a synthesized rules.txt matches whatever
// region the user dumped.
const BOTW_TITLE_IDS =
  "00050000101C9300,00050000101C9400,00050000101C9500";

const DEPLOY_ROOT = "GameHubMods";

interface Staging {
  root: string; // extracted archive root (dir containing content/rules/info)
  dir: string; // the temp staging dir we created (to clean up)
  name: string;
  gbModId: number;
  thumbnailUrl: string | null;
}

// stagingId → staging info, for the prepare → (choose options) → finalize round trip.
const stagings = new Map<string, Staging>();
let stagingSeq = 0;

const sanitize = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim() ||
  "Mod";

/** Resolve Cemu's (portable) data dir, or null when Cemu isn't set up. */
const resolveCemuDataDir = async (): Promise<string | null> => {
  const config = await getEmulatorConfig("wiiu").catch(() => null);
  if (config?.binary !== "cemu" || !config.executablePath) return null;
  return cemuDataDir(path.dirname(config.executablePath));
};

/** Find the archive subtree that actually holds the mod (content/rules/info). */
const findModRoot = (extractDir: string): string => {
  const looksLikeRoot = (dir: string): boolean =>
    existsSync(path.join(dir, "content")) ||
    existsSync(path.join(dir, "aoc")) ||
    existsSync(path.join(dir, "rules.txt")) ||
    existsSync(path.join(dir, "info.json"));

  if (looksLikeRoot(extractDir)) return extractDir;
  // Descend through single-child wrapper folders (a common archive shape).
  let cur = extractDir;
  for (let depth = 0; depth < 4; depth++) {
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      break;
    }
    const dirs = entries.filter((e) => {
      try {
        return statSync(path.join(cur, e)).isDirectory();
      } catch {
        return false;
      }
    });
    if (dirs.length === 1) {
      cur = path.join(cur, dirs[0]);
      if (looksLikeRoot(cur)) return cur;
    } else {
      break;
    }
  }
  return extractDir;
};

interface RawOption {
  name?: string;
  desc?: string;
  folder?: string;
}
interface RawGroup {
  name?: string;
  desc?: string;
  required?: boolean;
  options?: RawOption[];
}

/** Parse a BNP info.json into our ModOptionGroup[] (single = radio, multi = checkbox). */
const parseInfoJson = (root: string): ModOptionGroup[] => {
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

  const mapGroup = (
    g: RawGroup,
    type: "single" | "multi"
  ): ModOptionGroup => ({
    name: g.name ?? "Options",
    description: g.desc ?? "",
    type,
    required: Boolean(g.required),
    options: (g.options ?? [])
      .filter((o) => o.folder)
      .map((o) => ({
        name: o.name ?? o.folder ?? "Option",
        description: o.desc ?? "",
        folder: o.folder as string,
      })),
  });

  const groups: ModOptionGroup[] = [];
  for (const g of opts.single ?? []) groups.push(mapGroup(g, "single"));
  for (const g of opts.multi ?? []) groups.push(mapGroup(g, "multi"));
  return groups.filter((g) => g.options.length > 0);
};

/**
 * Stage a downloaded mod file for install: extract it, locate its root, and
 * detect whether it has configurable options. When it does, we return the
 * option groups and a stagingId; the caller shows the chooser and calls
 * `finalizeModInstall`. When it doesn't, the caller finalizes immediately with
 * no selected folders.
 */
export const prepareModInstall = async (
  filePath: string,
  meta: { gbModId: number; name: string; thumbnailUrl: string | null }
): Promise<ModInstallPrep> => {
  const cemuData = await resolveCemuDataDir();
  if (!cemuData) return { ok: false, reason: "Cemu is not set up for this game" };

  const dir = path.join(os.tmpdir(), `gh-bnp-${Date.now()}-${++stagingSeq}`);
  mkdirSync(dir, { recursive: true });
  try {
    const extraction = await SevenZip.extractFile({
      filePath,
      outputPath: dir,
    });
    if (!extraction.success) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, reason: "Couldn't extract the mod archive" };
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    return { ok: false, reason: `Couldn't extract the mod: ${err}` };
  }

  const root = findModRoot(dir);
  if (
    !existsSync(path.join(root, "content")) &&
    !existsSync(path.join(root, "aoc"))
  ) {
    rmSync(dir, { recursive: true, force: true });
    return {
      ok: false,
      reason: "This mod has no game content — it may not be a BOTW/Cemu mod.",
    };
  }

  const stagingId = `stg-${Date.now()}-${stagingSeq}`;
  stagings.set(stagingId, {
    root,
    dir,
    name: meta.name,
    gbModId: meta.gbModId,
    thumbnailUrl: meta.thumbnailUrl,
  });

  const optionGroups = parseInfoJson(root);
  if (optionGroups.length > 0) {
    return {
      ok: true,
      needsOptions: true,
      stagingId,
      name: meta.name,
      optionGroups,
    };
  }
  return { ok: true, stagingId };
};

/** Merge src/<sub> into dst/<sub> (content, aoc), overwriting existing files. */
const mergeSub = (srcRoot: string, dstRoot: string, sub: string): void => {
  const src = path.join(srcRoot, sub);
  if (!existsSync(src)) return;
  const dst = path.join(dstRoot, sub);
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
};

/** Copy the BNP's rules.txt, rewriting name/path so it's unique + points at us. */
const writeRules = (
  root: string,
  deployDir: string,
  displayName: string
): void => {
  const dest = path.join(deployDir, "rules.txt");
  const src = path.join(root, "rules.txt");
  if (existsSync(src)) {
    // Reuse the BNP's definition (correct titleIds/version) but force a unique
    // name + a path under our GameHub category so packs don't collide.
    let txt = readFileSync(src, "utf-8");
    if (/^\s*name\s*=/im.test(txt)) {
      txt = txt.replace(/^(\s*)name\s*=.*/im, `$1name = ${displayName}`);
    } else {
      txt = txt.replace(/\[Definition\]/i, `[Definition]\nname = ${displayName}`);
    }
    if (/^\s*path\s*=/im.test(txt)) {
      txt = txt.replace(
        /^(\s*)path\s*=.*/im,
        `$1path = "GameHub Mods/${displayName}"`
      );
    } else {
      txt = txt.replace(
        /\[Definition\]/i,
        `[Definition]\npath = "GameHub Mods/${displayName}"`
      );
    }
    writeFileSync(dest, txt, "utf-8");
    return;
  }
  // No rules.txt in the BNP — synthesize a content-redirection graphic pack.
  const rules = [
    "[Definition]",
    `titleIds = ${BOTW_TITLE_IDS}`,
    `name = ${displayName}`,
    `path = "GameHub Mods/${displayName}"`,
    `description = Installed by GameHub`,
    "version = 7",
    "",
  ].join("\n");
  writeFileSync(dest, rules, "utf-8");
};

/**
 * Finalize a staged install: merge base content + any chosen option folders,
 * deploy as a Cemu graphic pack under graphicPacks/GameHubMods/<name>/, enable
 * it, and record it. `selectedFolders` are the `options/<folder>` names chosen
 * in the option chooser (empty for option-less mods).
 */
export const finalizeModInstall = async (
  shop: GameShop,
  objectId: string,
  stagingId: string,
  selectedFolders: string[]
): Promise<{ ok: boolean; reason?: string }> => {
  const staging = stagings.get(stagingId);
  if (!staging) {
    return { ok: false, reason: "This install session expired — try again." };
  }
  const cemuData = await resolveCemuDataDir();
  if (!cemuData) {
    cleanup(stagingId);
    return { ok: false, reason: "Cemu is not set up for this game" };
  }

  const displayName = sanitize(staging.name);
  const deployDir = path.join(
    cemuData,
    "graphicPacks",
    DEPLOY_ROOT,
    displayName
  );

  try {
    // Fresh deploy — remove any prior copy of this exact pack.
    if (existsSync(deployDir)) {
      rmSync(deployDir, { recursive: true, force: true });
    }
    mkdirSync(deployDir, { recursive: true });

    // Base content + DLC.
    mergeSub(staging.root, deployDir, "content");
    mergeSub(staging.root, deployDir, "aoc");

    // Chosen option folders layer over the base (later selections win).
    for (const folder of selectedFolders) {
      const optRoot = path.join(staging.root, "options", folder);
      mergeSub(optRoot, deployDir, "content");
      mergeSub(optRoot, deployDir, "aoc");
    }

    writeRules(staging.root, deployDir, displayName);
  } catch (err) {
    logger.error("[botw-mod] deploy failed", err);
    cleanup(stagingId);
    return { ok: false, reason: `Couldn't deploy the mod: ${err}` };
  }

  // Ensure a title id ends up in the rules if it was synthesized-but-empty.
  await ensureTitleId(deployDir, shop, objectId);

  const rulesId = path
    .relative(cemuData, path.join(deployDir, "rules.txt"))
    .split(path.sep)
    .join("/");

  await setGraphicPackEnabled(rulesId, true).catch(() => {});

  const list = await getInstalled(shop, objectId);
  // Replace an existing entry with the same name (re-install), else append.
  const existingIdx = list.findIndex((m) => sanitize(m.name) === displayName);
  const entry: InstalledMod = {
    gbModId: staging.gbModId,
    name: staging.name,
    fileName: `${displayName}.bnp`,
    thumbnailUrl: staging.thumbnailUrl,
    installedAt: new Date().toISOString(),
    packRulesId: rulesId,
  };
  if (existingIdx >= 0) list[existingIdx] = entry;
  else list.push(entry);
  await installedModsSublevel.put(modsKey(shop, objectId), list);

  cleanup(stagingId);
  logger.log(`[botw-mod] deployed "${staging.name}" → ${rulesId}`);
  return { ok: true };
};

/** If the deployed rules.txt has no titleIds, backfill from the game's meta.xml. */
const ensureTitleId = async (
  deployDir: string,
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const rulesPath = path.join(deployDir, "rules.txt");
  try {
    const txt = readFileSync(rulesPath, "utf-8");
    if (/^\s*titleIds\s*=\s*\S/im.test(txt)) return;
    const titleId = await resolveWiiuTitleId(shop, objectId);
    const ids = titleId ? titleId.toUpperCase() : BOTW_TITLE_IDS;
    const patched = /\[Definition\]/i.test(txt)
      ? txt.replace(/\[Definition\]/i, `[Definition]\ntitleIds = ${ids}`)
      : `[Definition]\ntitleIds = ${ids}\n${txt}`;
    writeFileSync(rulesPath, patched, "utf-8");
  } catch {
    /* best effort */
  }
};

const cleanup = (stagingId: string): void => {
  const staging = stagings.get(stagingId);
  if (staging) {
    try {
      rmSync(staging.dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    stagings.delete(stagingId);
  }
};

/** Cancel a staged install that the user backed out of (frees temp files). */
export const cancelModInstall = (stagingId: string): void => cleanup(stagingId);

const modsKey = (shop: GameShop, objectId: string) =>
  levelKeys.game(shop, objectId);

const getInstalled = async (
  shop: GameShop,
  objectId: string
): Promise<InstalledMod[]> =>
  (await installedModsSublevel
    .get(modsKey(shop, objectId))
    .catch(() => null)) ?? [];

/**
 * Uninstall a natively-deployed mod: remove its Cemu graphic-pack folder, drop
 * its settings.xml entry, and forget it. Falls back gracefully when the mod
 * predates native deployment (no packRulesId).
 */
export const uninstallNativeMod = async (
  shop: GameShop,
  objectId: string,
  index: number
): Promise<{ ok: boolean; reason?: string }> => {
  const list = await getInstalled(shop, objectId);
  const mod = list[index];
  if (!mod) return { ok: false, reason: "Mod not found" };

  const cemuData = await resolveCemuDataDir();
  if (cemuData && mod.packRulesId) {
    await setGraphicPackEnabled(mod.packRulesId, false).catch(() => {});
    const packDir = path.dirname(path.join(cemuData, mod.packRulesId));
    try {
      if (existsSync(packDir)) rmSync(packDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn("[botw-mod] couldn't remove pack folder", err);
    }
  }

  list.splice(index, 1);
  await installedModsSublevel.put(modsKey(shop, objectId), list);
  return { ok: true };
};

/** True when at least one deployed GameHub mod is enabled in settings.xml. */
export const areNativeModsEnabled = async (
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const cemuData = await resolveCemuDataDir();
  if (!cemuData) return false;
  const settingsFile = path.join(cemuData, "settings.xml");
  if (!existsSync(settingsFile)) return false;
  const xml = readFileSync(settingsFile, "utf-8");
  const list = await getInstalled(shop, objectId);
  return list.some((m) => m.packRulesId && xml.includes(m.packRulesId));
};

/** Enable/disable every deployed GameHub mod for this game at once. */
export const setNativeModsEnabled = async (
  shop: GameShop,
  objectId: string,
  enabled: boolean
): Promise<{ ok: boolean }> => {
  const list = await getInstalled(shop, objectId);
  for (const mod of list) {
    if (mod.packRulesId) {
      await setGraphicPackEnabled(mod.packRulesId, enabled).catch(() => {});
    }
  }
  return { ok: true };
};
