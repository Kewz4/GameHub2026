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
  searchAzaharSaveTreeForTitleId,
  searchSaveTreeForNeedle,
} from "./emulator-title-id";
import {
  buildEmulatorRestorePatterns,
  findRalibretroSaveFiles,
  findRpcs3ProfileSaveRoots,
  fingerprintSavePaths,
  pathContainsFile,
  resolveStoredGameRomPath,
} from "./emulator-save-paths";

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
    case "rpcs3": {
      // Enumerate every RPCS3 home profile instead of silently ignoring saves
      // outside the default 00000001 account. Preserve a creatable default for
      // the open-folder UI when RPCS3 has not created a profile yet.
      const profileRoots = findRpcs3ProfileSaveRoots(installDir);
      return profileRoots.length > 0
        ? profileRoots
        : [path.join(installDir, "dev_hdd0", "home", "00000001", "savedata")];
    }
    case "pcsx2": {
      // The memcard resolvers filter to dirs that EXIST, so before PCSX2 has
      // created a card they return [] — which would make the whole save
      // location resolve to null ("not found"). Fall back to the portable
      // memcards dir so an installed-but-unused PCSX2 still has a valid,
      // creatable save folder.
      const dirs = getPs2MemcardDirs(executablePath ?? null);
      return dirs.length ? dirs : [path.join(installDir, "memcards")];
    }
    case "duckstation": {
      const dirs = getPs1MemcardDirs();
      return dirs.length ? dirs : [path.join(installDir, "memcards")];
    }
    case "ralibretro":
      // Shared discovery root. The backup resolver narrows this to the current
      // ROM's exact file(s); it is never registered wholesale.
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
 * title id can't be resolved (game not yet registered by RPCS3); automatic
 * backup treats that as unisolatable and does not capture a whole profile.
 */
const resolvePs3SaveSubfolders = async (
  loc: EmulatorSaveLocation,
  shop: GameShop,
  objectId: string
): Promise<string[] | null> => {
  const titleId = await resolvePs3TitleId(loc, shop, objectId);
  if (!titleId) return null;

  const subfolders: string[] = [];
  for (const savedataRoot of loc.folders) {
    try {
      subfolders.push(
        ...fs
          .readdirSync(savedataRoot, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isDirectory() &&
              entry.name.toLowerCase().includes(titleId.toLowerCase())
          )
          .map((entry) => path.join(savedataRoot, entry.name))
      );
    } catch {
      // This profile has no savedata directory yet.
    }
  }
  return subfolders;
};

const resolvePs3TitleId = async (
  loc: EmulatorSaveLocation,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  const romPath = resolveStoredGameRomPath(game);
  if (!romPath) return null;

  const index = buildPathToTitleIdIndex(await readGamesYml(loc.executablePath));
  const norm = path.normalize(romPath).replace(/[\\/]+$/, "");
  let titleId =
    index.get(norm) ??
    index.get(path.basename(norm)) ??
    index.get(path.basename(path.dirname(norm))) ??
    null;
  if (!titleId && process.platform === "win32") {
    const candidates = new Set(
      [norm, path.basename(norm), path.basename(path.dirname(norm))].map((p) =>
        p.toLowerCase()
      )
    );
    for (const [candidate, candidateTitleId] of index) {
      if (candidates.has(candidate.toLowerCase())) {
        titleId = candidateTitleId;
        break;
      }
    }
  }
  return titleId;
};

/**
 * Generic per-title narrowing for the id-based folder emulators (Switch / 3DS /
 * Wii): derive the game's platform id from its ROM, then search the save tree
 * for the folder(s) named with it. Returns null when the id can't be read and
 * an empty array when the id is known but no matching save exists.
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
  const romPath = resolveStoredGameRomPath(game);
  const needle = resolveConsoleSaveNeedle(loc.system, romPath);
  if (!needle) return null;
  return loc.system === "n3ds"
    ? searchAzaharSaveTreeForTitleId(loc.folders, needle)
    : searchSaveTreeForNeedle(loc.folders, needle);
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

  if (loc.binary === "ralibretro") {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    const romPath = resolveStoredGameRomPath(game);
    if (romPath) {
      const saves = findRalibretroSaveFiles(loc.folders, romPath);
      if (saves.length > 0) return path.dirname(saves[0]);
    }
  }

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
 * Cheap fingerprint of save files and/or folders: file count + total bytes +
 * newest mtime, from a bounded walk. Used to SKIP the backup pipeline (ludusavi
 * scan → copy → tar → upload) when nothing changed since the last upload —
 * the common case when a session ends without new progress.
 */
export const fingerprintSaveFolders = (folders: string[]): string => {
  return fingerprintSavePaths(folders);
};

/**
 * Isolated paths to register with Ludusavi for a console game's backup. A
 * mapper that cannot prove a per-game path returns no paths rather than risking
 * a console-wide or shared-memory-card restore over unrelated games.
 */
export const resolveEmulatorBackupFolders = async (
  shop: GameShop,
  objectId: string
): Promise<string[]> => {
  const loc = await resolveEmulatorSaveLocation(shop, objectId);
  if (!loc) return [];

  // RALibretro's Saves directory is shared by every core and game. Register
  // only this ROM's exact save payload; if it has not saved yet, there is
  // nothing safe to upload.
  if (loc.binary === "ralibretro") {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    const romPath = resolveStoredGameRomPath(game);
    return romPath ? findRalibretroSaveFiles(loc.folders, romPath) : [];
  }

  // These formats use shared memory-card images. Uploading a whole card from a
  // single game's automatic sync can overwrite unrelated games on restore;
  // the dedicated memory-card manager is the safe per-save path instead.
  if (
    loc.binary === "pcsx2" ||
    loc.binary === "duckstation" ||
    (loc.binary === "dolphin" && loc.system === "gc")
  ) {
    return [];
  }

  if (loc.system === "wiiu") {
    const titleId = await resolveWiiuTitleId(shop, objectId);
    if (!titleId || titleId.length !== 16) return [];
    const titleRoot = path.join(
      loc.folders[0],
      titleId.slice(0, 8),
      titleId.slice(8)
    );
    const userRoot = path.join(titleRoot, "user");
    // A known Cemu title can already have its exact save container even when
    // the first in-game save has not written a payload yet. Keep that precise
    // per-title mapping visible (and usable for a future restore); upload still
    // rejects an empty backup before anything reaches R2.
    return fs.existsSync(userRoot) ? [userRoot] : [];
  }

  // RPCS3: back up only this game's savedata folder(s), across every home
  // profile. Never fall back to a whole profile when games.yml cannot identify
  // the title or the game has no save.
  if (loc.binary === "rpcs3") {
    return (
      (await resolvePs3SaveSubfolders(loc, shop, objectId))?.filter(
        pathContainsFile
      ) ?? []
    );
  }

  // Switch / 3DS / Wii: only exact title-id matches are safe. `null` means the
  // ROM format did not expose an id; an empty array means the id is known but
  // this game has not saved yet. Neither case may capture the console-wide
  // tree, which contains other games and emulator system data.
  const needleMatches = await resolveNeedleMatches(loc, shop, objectId);
  if (needleMatches) {
    return needleMatches.filter(pathContainsFile);
  }

  return [];
};

/**
 * Resolve exact destinations that are safe for restore even before this title
 * has created a local save. Shared memory-card formats remain deliberately
 * unsupported; their dedicated save manager is the only safe restore flow.
 */
export const resolveEmulatorRestorePatterns = async (
  shop: GameShop,
  objectId: string
): Promise<string[]> => {
  const loc = await resolveEmulatorSaveLocation(shop, objectId);
  if (!loc) return [];
  if (
    loc.binary === "pcsx2" ||
    loc.binary === "duckstation" ||
    (loc.binary === "dolphin" && loc.system === "gc")
  ) {
    return [];
  }

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  const romPath = resolveStoredGameRomPath(game);

  let identity: string | null = null;
  if (loc.system === "wiiu") {
    identity = await resolveWiiuTitleId(shop, objectId);
  } else if (loc.binary === "rpcs3") {
    identity = await resolvePs3TitleId(loc, shop, objectId);
  } else if (
    loc.system === "switch" ||
    loc.system === "n3ds" ||
    loc.system === "wii"
  ) {
    identity = resolveConsoleSaveNeedle(loc.system, romPath);
  }

  return buildEmulatorRestorePatterns({
    system: loc.system,
    binary: loc.binary,
    roots: loc.folders,
    romPath,
    identity,
  });
};
