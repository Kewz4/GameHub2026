import fs from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { logger } from "@main/services";

export interface LibraryInstallationReport {
  total: number;
  installed: number;
  notInstalled: number;
  /** Games whose executable/disc vanished from disk (stale "installed" flag). */
  stale: Array<{
    title: string;
    shop: string;
    objectId: string;
    path: string;
  }>;
  /** Games found on disk but not marked installed (healable in one pass). */
  found: Array<{ title: string; shop: string; objectId: string; path: string }>;
}

const pathExists = (candidate?: string | null) => {
  if (!candidate) return false;
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
};

const getGamePrimaryPath = (game: {
  shop: string;
  executablePath?: string | null;
  nativeExecutablePath?: string | null;
  selectedDiscPath?: string | null;
  discs?: Array<{ path: string }> | null;
}): string | null => {
  // Emulated games bind a ROM disc, not a game executable.
  if (game.shop === "launchbox") {
    return (
      game.selectedDiscPath ??
      game.discs?.map((disc) => disc.path).find(pathExists) ??
      null
    );
  }

  return game.nativeExecutablePath ?? game.executablePath ?? null;
};

const isProtocolUri = (value: string | null | undefined) =>
  Boolean(value && /^[a-z]+:\/\//i.test(value));

/**
 * Verify the installation state of the ENTIRE library in one pass.
 *
 * Unlike scanInstalledGames (which only resolves games that lack an
 * executable), this checker audits every entry:
 *   - PC games are installed when their bound executable still exists.
 *   - Emulated (launchbox) games are installed when their bound ROM disc
 *     still exists — no game executable involved.
 *   - Protocol-URI games (steam://…, legendary://…) are never marked
 *     not-installed from a local file check; their platform owns state.
 *
 * Returns a report and, when `writeThrough` is true, heals the
 * `isInstalledLocally` flag so the library UI reflects reality.
 */
const checkLibraryInstallation = async (
  _event: Electron.IpcMainInvokeEvent,
  writeThrough = true
): Promise<LibraryInstallationReport> => {
  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) => results.filter(([_key, game]) => !game.isDeleted));

  let installed = 0;
  let notInstalled = 0;
  const stale: LibraryInstallationReport["stale"] = [];
  const found: LibraryInstallationReport["found"] = [];

  for (const [key, game] of games) {
    const primaryPath = getGamePrimaryPath(game);

    // Store-URI games rely on their platform, not a local file.
    if (isProtocolUri(primaryPath)) {
      installed++;
      continue;
    }

    const exists = pathExists(primaryPath);
    const wasInstalled = game.isInstalledLocally === true;

    if (exists) {
      installed++;
      if (!wasInstalled) {
        found.push({
          title: game.title,
          shop: game.shop,
          objectId: game.objectId,
          path: primaryPath ?? "",
        });
        if (writeThrough) {
          await gamesSublevel.put(key, {
            ...game,
            isInstalledLocally: true,
          });
        }
      }
      continue;
    }

    notInstalled++;
    if (wasInstalled && primaryPath) {
      stale.push({
        title: game.title,
        shop: game.shop,
        objectId: game.objectId,
        path: primaryPath,
      });
      if (writeThrough) {
        await gamesSublevel.put(key, {
          ...game,
          isInstalledLocally: false,
        });
      }
    }
  }

  const report = {
    total: games.length,
    installed,
    notInstalled,
    stale,
    found,
  };

  logger.log("[LibraryInstallation] Checked library", {
    total: report.total,
    installed,
    notInstalled,
    staleCount: stale.length,
    foundCount: found.length,
    writeThrough,
  });

  return report;
};

registerEvent("checkLibraryInstallation", checkLibraryInstallation);
