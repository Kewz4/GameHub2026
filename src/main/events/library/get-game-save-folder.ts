import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi, logger } from "@main/services";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import path from "node:path";
import fs from "node:fs";

/** Turn an expanded manifest path (which may contain globs or point at a
 * file) into a concrete folder candidate. */
const toFolderCandidate = (expandedPath: string): string => {
  // Cut at the first glob segment ("*", "?")
  const segments = expandedPath.split(/[/\\]+/);
  const globIndex = segments.findIndex(
    (s) => s.includes("*") || s.includes("?")
  );
  const cleanSegments =
    globIndex === -1 ? segments : segments.slice(0, globIndex);
  const candidate = cleanSegments.join(path.sep);

  // If it exists and is a directory, use it as-is; otherwise treat the last
  // segment as a file and use its parent.
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  } catch {
    // fall through
  }
  return path.dirname(candidate);
};

const getGameSaveFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  try {
    const gameKey = levelKeys.game(shop, objectId);

    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const assets = await gamesShopAssetsSublevel.get(gameKey).catch(() => null);
    const gameTitle = game?.title ?? assets?.title ?? null;

    if (!gameTitle) {
      logger.warn(`[getGameSaveFolder] No title for ${shop}:${objectId}`);
      return null;
    }

    // Fast path: read manifest.yaml directly (no ludusavi binary unless title
    // doesn't match exactly). Returns only fully-expanded paths.
    const executablePath = game?.executablePath ?? null;
    const paths = await Ludusavi.findSavePathsFast(
      shop,
      gameTitle,
      objectId,
      executablePath
    );

    if (paths.length === 0) {
      logger.info(
        `[getGameSaveFolder] No expanded save path found for ${shop}:${objectId}`
      );
      return null;
    }

    // The game's install dir (where the exe lives). Manifest <base> paths
    // expand to this dir, but the real save location is usually somewhere
    // under AppData/Documents — so prefer those when they actually exist.
    const installDir =
      executablePath && !executablePath.includes("://")
        ? path.dirname(executablePath)
        : null;

    const isInsideInstallDir = (p: string) =>
      installDir !== null &&
      p.toLowerCase().startsWith(installDir.toLowerCase());

    const candidates = paths.map(toFolderCandidate);

    // Rank: 1) exists outside install dir  2) exists anywhere
    //       3) doesn't exist but is outside install dir
    const existing = candidates.filter((c) => {
      try {
        return fs.existsSync(c) && fs.statSync(c).isDirectory();
      } catch {
        return false;
      }
    });

    const best =
      existing.find((c) => !isInsideInstallDir(c)) ??
      existing[0] ??
      candidates.find((c) => !isInsideInstallDir(c)) ??
      null;

    if (best) {
      logger.info(`[getGameSaveFolder] ${shop}:${objectId} → ${best}`);
      return best;
    }

    logger.info(
      `[getGameSaveFolder] Only nonexistent install-dir candidates for ${shop}:${objectId}`
    );
    return null;
  } catch (error) {
    logger.error("[getGameSaveFolder] Error:", error);
    return null;
  }
};

registerEvent("getGameSaveFolder", getGameSaveFolder);
