import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem, GameShop } from "@types";
import { systemFromObjectId, platformToSystem } from "@main/helpers";
import { levelKeys, gamesSublevel } from "@main/level";
import { getEmulatorConfig } from "./emulators-repository";
import { KNOWN_BINARIES } from "./known-binaries";
import { cemuDataDir } from "./emulator-portable";
import { resolveWiiuTitleId } from "./cemu-graphic-packs";

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
]);

export const isFolderSaveSystem = (system: EmulatorSystem): boolean =>
  FOLDER_SAVE_SYSTEMS.has(system);

/** Absolute save-root folders for a system given its install directory. */
export const getEmulatorSaveRoots = (
  system: EmulatorSystem,
  installDir: string
): string[] => {
  switch (system) {
    case "n3ds":
      return [
        path.join(installDir, "user", "sdmc"),
        path.join(installDir, "user", "nand"),
      ];
    case "wiiu":
      return [path.join(cemuDataDir(installDir), "mlc01", "usr", "save")];
    case "wii":
      return [path.join(installDir, "User", "Wii")];
    case "gc":
      return [path.join(installDir, "User", "GC")];
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
  /** Existing save-root folders on disk to back up. */
  folders: string[];
}

/**
 * Resolve the existing emulator save folders for a console game. Returns null
 * when the game isn't a folder-based console game or its emulator isn't
 * installed. Folder granularity is per-console (the emulator's whole save tree),
 * which is robust without a per-title-ID database — restoring merges the tree.
 */
export const resolveEmulatorSaveLocation = async (
  shop: GameShop,
  objectId: string
): Promise<EmulatorSaveLocation | null> => {
  const system = await systemForGame(shop, objectId);
  if (!system || !isFolderSaveSystem(system)) return null;

  const config = await getEmulatorConfig(system).catch(() => null);
  if (!config?.executablePath || !fs.existsSync(config.executablePath)) {
    return null;
  }

  const installDir = path.dirname(config.executablePath);
  const folders = getEmulatorSaveRoots(system, installDir).filter((dir) =>
    fs.existsSync(dir)
  );
  if (folders.length === 0) return null;

  return {
    system,
    binary: KNOWN_BINARIES[system].binary,
    folders,
  };
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

  return loc.folders[0] ?? null;
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
    if (specific && specific !== loc.folders[0]) return [specific];
  }

  return loc.folders;
};
