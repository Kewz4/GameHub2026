import os from "node:os";
import path from "node:path";

import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import type { Game, GameShop, LudusaviBackup } from "@types";

import {
  resolveEmulatorBackupFolders,
  systemForGame,
} from "./emulators/emulator-save-dirs";
import { logger } from "./logger";
import { Ludusavi } from "./ludusavi";

export type SaveBackupPlanSource = "manual" | "emulator" | "pc" | "manifest";

export interface ReadySaveBackupPlan {
  status: "ready";
  source: SaveBackupPlanSource;
  title: string;
  backupName: string;
  paths: string[];
  customBackupPath: string | null;
  warning?: string | null;
}

export interface UnresolvedSaveBackupPlan {
  status: "unresolved";
  source: "emulator" | "pc";
  title: string;
  reason: string;
  paths: string[];
  customBackupPath: null;
}

export type SaveBackupPlan = ReadySaveBackupPlan | UnresolvedSaveBackupPlan;

const stableAutomaticKey = (
  kind: "emulator" | "pc",
  shop: GameShop,
  objectId: string
) => `gamehub-${kind}:${shop}:${objectId}`;

const getPhysicalExecutablePath = (
  game: Game | null | undefined
): string | null => {
  const candidates = [game?.nativeExecutablePath, game?.executablePath];
  for (const candidate of candidates) {
    if (!candidate || candidate.includes("://")) continue;
    return candidate;
  }
  return null;
};

const pathBeforeGlob = (value: string): string => {
  const parts = value.split(/[\\/]+/);
  const firstGlob = parts.findIndex(
    (part) => part.includes("*") || part.includes("?")
  );
  return (firstGlob === -1 ? parts : parts.slice(0, firstGlob)).join(path.sep);
};

/**
 * Reject only unmistakably broad automatic mappings. A curated manifest may
 * legitimately point at a game's directory beneath AppData or Documents, but
 * it must never register a drive, home, or whole profile folder as one game.
 */
export const isSafeAutomaticSavePath = (candidate: string): boolean => {
  if (!candidate || candidate.includes("<")) return false;

  const concrete = path.resolve(pathBeforeGlob(candidate));
  const normalize = (value: string) =>
    path
      .normalize(value)
      .replace(/[\\/]+$/, "")
      .toLowerCase();
  const normalized = normalize(concrete);
  const broadRoots = [
    path.parse(concrete).root,
    os.homedir(),
    process.env.USERPROFILE,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalize);

  return !broadRoots.includes(normalized);
};

const emptyPreview = (plan: UnresolvedSaveBackupPlan): LudusaviBackup => ({
  overall: {
    totalGames: 0,
    totalBytes: 0,
    processedGames: 0,
    processedBytes: 0,
    changedGames: { new: 0, different: 0, same: 0 },
  },
  games: {},
  customBackupPath: null,
  mappingSource: plan.source,
  mappingError: plan.reason,
  mappingWarning: null,
  resolvedPaths: [],
});

/**
 * Resolve exactly one backup identity for every Game Details operation.
 * Priority is user mapping -> exact emulator save -> expanded PC manifest.
 * Emulator titles never enter fuzzy PC matching, and PC mappings never fall
 * back to an opaque canonical backup that cannot be containment-checked.
 */
export const resolveSaveBackupPlan = async (
  shop: GameShop,
  objectId: string
): Promise<SaveBackupPlan> => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const assets = await gamesShopAssetsSublevel.get(gameKey).catch(() => null);
  const title = game?.title ?? assets?.title ?? objectId;

  const manual = await Ludusavi.getManualCustomGame(shop, objectId);
  if (manual?.files.length) {
    return {
      status: "ready",
      source: "manual",
      title,
      backupName: manual.name,
      paths: [...manual.files],
      customBackupPath: manual.files[0] ?? null,
    };
  }

  const emulatorSystem = await systemForGame(shop, objectId);
  if (emulatorSystem) {
    const backupName = stableAutomaticKey("emulator", shop, objectId);
    const paths = await resolveEmulatorBackupFolders(shop, objectId);
    await Ludusavi.addCustomGame(backupName, paths.length ? paths : null);

    if (!paths.length) {
      return {
        status: "unresolved",
        source: "emulator",
        title,
        reason:
          "No isolated save exists for this game yet. Shared memory cards and whole-emulator folders are never backed up automatically; choose a specific manual folder if needed.",
        paths: [],
        customBackupPath: null,
      };
    }

    return {
      status: "ready",
      source: "emulator",
      title,
      backupName,
      paths,
      customBackupPath: null,
    };
  }

  const executablePath = getPhysicalExecutablePath(game);
  const automaticKey = stableAutomaticKey("pc", shop, objectId);
  const manifestMapping = await Ludusavi.findSaveMappingFast(
    shop,
    title,
    objectId,
    executablePath
  );
  const expandedPaths = manifestMapping.paths.filter(isSafeAutomaticSavePath);
  const paths = [...new Set(expandedPaths)];
  const registry = [...new Set(manifestMapping.registry)];

  if (paths.length) {
    // Registry payloads require a separately validated and rollback-capable
    // restore path. Until that exists, never put registry.reg into an R2
    // artifact that GameHub would later claim to restore completely.
    await Ludusavi.addCustomGame(automaticKey, paths, []);
    return {
      status: "ready",
      source: "pc",
      title,
      backupName: automaticKey,
      paths,
      customBackupPath: null,
      warning: registry.length
        ? "Windows Registry save data was also detected, but GameHub currently syncs only this game's files. Registry data is excluded so restores cannot report a partial success."
        : null,
    };
  }

  // Clear an old generated entry before falling back; it may point at an old
  // installation that no longer belongs to this game.
  await Ludusavi.addCustomGame(automaticKey, null);
  if (registry.length) {
    return {
      status: "unresolved",
      source: "pc",
      title,
      reason:
        "This game's detected save data is stored only in the Windows Registry. GameHub does not sync registry-only saves yet because it cannot restore them safely; choose a file-based save folder manually if the game also has one.",
      paths: [],
      customBackupPath: null,
    };
  }

  return {
    status: "unresolved",
    source: "pc",
    title,
    reason:
      "No trustworthy per-game save mapping was found. Choose the game's save folder manually; GameHub will not use a low-confidence title guess.",
    paths: [],
    customBackupPath: null,
  };
};

export const getSaveBackupPreview = async (
  shop: GameShop,
  objectId: string,
  winePrefix?: string | null
): Promise<LudusaviBackup> => {
  const plan = await resolveSaveBackupPlan(shop, objectId);
  if (plan.status === "unresolved") return emptyPreview(plan);

  try {
    const preview = await Ludusavi.backupGame(
      shop,
      plan.backupName,
      null,
      winePrefix,
      true
    );
    return {
      ...preview,
      customBackupPath: plan.customBackupPath,
      mappingSource: plan.source,
      mappingError: null,
      mappingWarning: plan.warning ?? null,
      resolvedPaths: [...plan.paths],
    };
  } catch (error) {
    logger.error("[save-mapper] preview failed", {
      shop,
      objectId,
      source: plan.source,
      error,
    });
    return emptyPreview({
      status: "unresolved",
      source: plan.source === "emulator" ? "emulator" : "pc",
      title: plan.title,
      reason: error instanceof Error ? error.message : String(error),
      paths: [],
      customBackupPath: null,
    });
  }
};
