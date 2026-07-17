import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem, GameShop } from "@types";
import { systemFromObjectId, platformToSystem } from "@main/helpers";
import { levelKeys, gamesSublevel } from "@main/level";
import { getEmulatorConfig } from "./emulators-repository";
import { KNOWN_BINARIES } from "./known-binaries";
import { cemuDataDir, edenDataDir } from "./emulator-portable";
import { resolveWiiuTitleId } from "./cemu-graphic-packs";
import { getPs2MemcardDirs } from "./ps2-memcard-dirs";
import { getPs1MemcardDirs } from "./ps1-memcard-dirs";
import { readGamesYml, buildPathToTitleIdIndex } from "./emulation-cloud-saves";
import {
  resolveConsoleSaveNeedle,
  searchSaveTreeForNeedle,
} from "./emulator-title-id";

/**
 * Resolves the on-disk save-data folders for the folder-based standalone
 * emulators (Azahar / Cemu / Dolphin), so console-game saves can be fed into
 * the cloud-save + Ludusavi backup pipeline the same way PC games are.
 *
 * We install these emulators in PORTABLE mode (see emulator-portable.ts), so the
 * save roots live inside the install folder rather than AppData:
 *   - Azahar (n3ds): <install>/user/sdmc (SD card game saves + extdata) and
 *                    <install>/user/nand (system/NAND titles).
 *   - Cemu (wiiu):   <portable>/mlc01/usr/save (per-title Wii U saves).
 *   - Dolphin (wii): <install>/User/Wii (Wii NAND/title saves).
 *   - Dolphin (gc):  <install>/User/GC (GameCube memory-card .raw files).
 * RALibretro systems keep flat per-ROM .sram files in <install>/Saves, already
 * handled elsewhere; PS1/PS2 use the dedicated memory-card resolvers.
 */

/** The folder-based emulator systems whose saves live in a directory tree. */
const FOLDER_SAVE_SYSTEMS: ReadonlySet<EmulatorSystem> = new Set([
  "n3ds",
  "wiiu",
  "wii",
  "gc",
  "switch",
]);

export const isFolderSaveSystem = (system: EmulatorSystem): boolean =>
  FOLDER_SAVE_SYSTEMS.has(system);

/**
 * Absolute save-root folders, resolved by the EMULATOR BINARY (not the system),
 * so every console mapped to a known emulator is covered — including the
 * RALibretro retro systems (gb/gbc/gba/nds/dsi/n64/psp → flat `Saves` dir),
 * RPCS3 savedata, and the PS1/PS2 memory-card dirs.
 */
export const getEmulatorSaveRoots = (
  system: EmulatorSystem,
  installDir: string,
  binary?: string,
  executablePath?: string | null
): string[] => {
  switch (binary ?? KNOWN_BINARIES[system]?.binary) {
    case "azahar":
      return [
        path.join(installDir, "user", "sdmc"),
        path.join(installDir, "user", "nand"),
      ];
    case "cemu":
      return [path.join(cemuDataDir(installDir), "mlc01", "usr", "save")];
    case "dolphin":
      return system === "gc"
        ? [path.join(installDir, "User", "GC")]
        : [path.join(installDir, "User", "Wii")];
    case "rpcs3":
      // Per-game savedata folders live under this root; trophies excluded.
      return [
        path.join(installDir, "dev_hdd0", "home", "00000001", "savedata"),
      ];
    case "pcsx2":
      return getPs2MemcardDirs(executablePath ?? null);
    case "duckstation":
      return getPs1MemcardDirs();
    case "ralibretro":
      // Flat per-ROM save files (.srm etc.) — small, backed up as one tree.
      return [path.join(installDir, "Saves")];
    case "eden":
      // Eden (Yuzu/Sudachi derivative): in portable mode ALL data roots under
      // <install>/user (edenDataDir), so saves live at
      // <install>/user/nand/user/save — NOT <install>/nand/user/save, which
      // Eden never writes (that pointed the backup at a non-existent dir).
      return [path.join(edenDataDir(installDir), "nand", "user", "save")];
    default:
      return [];
  }
};

/** Derive the emulator system for a console game from its id/platform. */
export const systemForGame = async (
  shop: GameShop,
  objectId: string
): Promise<EmulatorSystem | null> => {
  const fromId = systemFromObjectId(objectId);
  if (fromId) return fromId;
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  return platformToSystem(game?.platform) ?? null;
};

export interface EmulatorSaveLocation {
  system: EmulatorSystem;
  binary: string;
  /** The emulator executable (used to find sibling databases like games.yml). */
  executablePath: string;
  /**
   * ALL configured save-root folders for this emulator. May include folders that
   * don't exist on disk yet (the game hasn't saved, or the emulator creates the
   * dir lazily on first run) — consumers decide: "open folder" creates it,
   * backup skips the ones that don't exist.
   */
  folders: string[];
}

/**
 * Resolve the emulator save folders for a console game. Returns null ONLY when
 * the game's emulator system can't be determined or the emulator isn't
 * installed (both genuinely unresolvable) — NOT merely because no save exists
 * yet. Folder granularity is per-console (the emulator's whole save tree),
 * which is robust without a per-title-ID database — restoring merges the tree.
 */
export const resolveEmulatorSaveLocation = async (
  shop: GameShop,
  objectId: string
): Promise<EmulatorSaveLocation | null> => {
  const system = await systemForGame(shop, objectId);
  if (!system) return null;

  const config = await getEmulatorConfig(system).catch(() => null);
  if (!config?.executablePath || !fs.existsSync(config.executablePath)) {
    return null;
  }

  const installDir = path.dirname(config.executablePath);
  // Keep every configured root, even if it doesn't exist yet — a game that
  // hasn't been played has no save folder, but the location is still known.
  const folders = getEmulatorSaveRoots(
    system,
    installDir,
    config.binary,
    config.executablePath
  );
  if (folders.length === 0) return null;

  return {
    system,
    binary: config.binary ?? KNOWN_BINARIES[system].binary,
    executablePath: config.executablePath,
    folders,
  };
};

/**
 * Narrow an RPCS3 savedata root to the folder(s) for one game, using RPCS3's own
 * `games.yml` (its database of TITLE_ID → game path). We map the game's ROM path
 * to its PS3 title id, then keep only the savedata subfolders whose name carries
 * that id (PS3 savedata dirs are named `<TITLE_ID>...`). Returns null when the
 * title id can't be resolved (game not yet registered by RPCS3) so callers fall
 * back to the whole savedata tree.
 */
const resolvePs3SaveSubfolders = async (
  loc: EmulatorSaveLocation,
  shop: GameShop,
  objectId: string
): Promise<string[] | null> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  const romPath = game?.executablePath;
  if (!romPath) return null;

  const index = buildPathToTitleIdIndex(await readGamesYml(loc.executablePath));
  const norm = path.normalize(romPath).replace(/[\\/]+$/, "");
  const titleId =
    index.get(norm) ??
    index.get(path.basename(norm)) ??
    index.get(path.basename(path.dirname(norm))) ??
    null;
  if (!titleId) return null;

  const savedataRoot = loc.folders[0];
  let subfolders: string[] = [];
  try {
    subfolders = fs
      .readdirSync(savedataRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.includes(titleId))
      .map((e) => path.join(savedataRoot, e.name));
  } catch {
    // savedata root doesn't exist yet — no saves for this title.
  }
  return subfolders;
};

/**
 * Generic per-title narrowing for the id-based folder emulators (Switch / 3DS /
 * Wii): derive the game's platform id from its ROM, then search the save tree
 * for the folder(s) named with it. Returns null when the id can't be read or no
 * matching folder exists yet, so callers fall back to the console-wide root.
 */
const resolveNeedleMatches = async (
  loc: EmulatorSaveLocation,
  shop: GameShop,
  objectId: string
): Promise<string[] | null> => {
  if (
    loc.system !== "switch" &&
    loc.system !== "n3ds" &&
    loc.system !== "wii"
  ) {
    return null;
  }
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  const needle = resolveConsoleSaveNeedle(loc.system, game?.executablePath);
  if (!needle) return null;
  const matches = searchSaveTreeForNeedle(loc.folders, needle);
  return matches.length > 0 ? matches : null;
};

/**
 * Resolve the single best save folder to OPEN for a specific game. For Cemu we
 * narrow to the exact per-title folder (mlc01/usr/save/<high>/<low>/user) when
 * the game's title id is readable; otherwise (and for other emulators, whose
 * per-title id can't be derived without header parsing) we return the
 * console-wide save root, which still lands the user in the right place.
 */
export const resolveEmulatorGameSaveFolder = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const loc = await resolveEmulatorSaveLocation(shop, objectId);
  if (!loc) return null;

  if (loc.system === "wiiu") {
    const titleId = await resolveWiiuTitleId(shop, objectId);
    if (titleId && titleId.length === 16) {
      const high = titleId.slice(0, 8);
      const low = titleId.slice(8);
      const withUser = path.join(loc.folders[0], high, low, "user");
      if (fs.existsSync(withUser)) return withUser;
      const withoutUser = path.join(loc.folders[0], high, low);
      if (fs.existsSync(withoutUser)) return withoutUser;
    }
  }

  // RPCS3: narrow to the game's own savedata folder via games.yml when it's
  // already registered + has a save; else fall through to the savedata root.
  if (loc.binary === "rpcs3") {
    const ps3 = await resolvePs3SaveSubfolders(loc, shop, objectId);
    if (ps3 && ps3.length > 0) return ps3[0];
  }

  // Switch / 3DS / Wii: narrow to the game's own save folder by searching the
  // save tree for its platform id (from the ROM). Falls back to console-wide.
  const needleMatches = await resolveNeedleMatches(loc, shop, objectId);
  if (needleMatches && needleMatches.length > 0) return needleMatches[0];

  // Prefer a root that already has saves; otherwise fall back to the first
  // configured root and CREATE it, so "Open save folder" always lands the user
  // in the right (possibly empty) place instead of failing with "not found"
  // just because this game hasn't saved yet. The emulator is installed (checked
  // in resolveEmulatorSaveLocation), so this dir is the correct location.
  const target =
    loc.folders.find((dir) => fs.existsSync(dir)) ?? loc.folders[0];
  if (!target) return null;
  if (!fs.existsSync(target)) {
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch {
      // If we can't create it, still return the path — the opener will surface
      // the real OS error rather than a misleading "not found".
    }
  }
  return target;
};

/**
 * Cheap fingerprint of a set of save folders: file count + total bytes + newest
 * mtime, from a bounded walk. Used to SKIP the whole backup pipeline (ludusavi
 * scan → copy → tar → upload) when nothing changed since the last upload —
 * the common case when a session ends without new progress.
 */
export const fingerprintSaveFolders = (folders: string[]): string => {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  let visited = 0;
  const stack = [...folders];
  while (stack.length && visited < 20_000) {
    const dir = stack.pop()!;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else {
        try {
          const st = fs.statSync(full);
          files += 1;
          bytes += st.size;
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return `${files}:${bytes}:${Math.floor(newest)}`;
};

/**
 * Folders to register with Ludusavi for a console game's backup. Cemu narrows
 * to the per-title folder (so a restore doesn't clobber every game's saves);
 * other emulators back up their whole save root (their per-title layout can't
 * be resolved reliably yet).
 */
export const resolveEmulatorBackupFolders = async (
  shop: GameShop,
  objectId: string
): Promise<string[]> => {
  const loc = await resolveEmulatorSaveLocation(shop, objectId);
  if (!loc) return [];

  if (loc.system === "wiiu") {
    const specific = await resolveEmulatorGameSaveFolder(shop, objectId);
    if (specific && specific !== loc.folders[0] && fs.existsSync(specific)) {
      return [specific];
    }
  }

  // RPCS3: back up only this game's savedata folder(s) when resolvable — so a
  // restore doesn't overwrite every PS3 game's saves.
  if (loc.binary === "rpcs3") {
    const ps3 = await resolvePs3SaveSubfolders(loc, shop, objectId);
    if (ps3 && ps3.length > 0) return ps3;
  }

  // Switch / 3DS / Wii: back up only this game's save folder(s) when its id
  // resolves and the folder exists — otherwise the whole console tree.
  const needleMatches = await resolveNeedleMatches(loc, shop, objectId);
  if (needleMatches && needleMatches.length > 0) return needleMatches;

  // Only back up roots that actually exist — a game that never saved simply has
  // nothing to back up (that's not an error). Filtering here also keeps Ludusavi
  // from registering phantom paths.
  return loc.folders.filter((dir) => fs.existsSync(dir));
};
