import { chunk } from "lodash-es";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { mergeWithRemoteGames } from "./merge-with-remote-games";
import { WindowManager } from "../window-manager";
import { AchievementWatcherManager } from "../achievements/achievement-watcher-manager";
import { gamesSublevel } from "@main/level";

export const uploadGamesBatch = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter(
        (game) =>
          !game.isDeleted &&
          game.remoteId === null &&
          game.shop !== "custom" &&
          // Only sync repack/catalogue games — platform-owned games (Steam,
          // Epic, GOG, etc.) are stamped "sync" and should never be uploaded
          // to the Hydra cloud. They are re-synced from the platform on each
          // login, so they don't need cloud backup.
          game.libraryOrigin !== "sync"
      );
    });

  type LocalGame = (typeof games)[number];

  const toPayload = (game: LocalGame) => ({
    objectId: game.objectId,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
    isFavorite: game.favorite,
    isPinned: game.isPinned ?? false,
  });

  // Use modest chunks. The Hydra API 500s the *entire* batch if any single
  // objectId in it is invalid/delisted, so a smaller chunk limits the blast
  // radius before we fall back to per-item uploads.
  const gamesChunks = chunk(games, 10);

  for (const gamesChunk of gamesChunks) {
    const ok = await HydraApi.post(
      "/profile/games/batch",
      gamesChunk.map(toPayload)
    )
      .then(() => true)
      .catch(() => false);

    if (ok) continue;

    // The bulk request failed (a single bad objectId 500s the whole chunk).
    // Retry each game individually so the valid ones still upload, and log
    // exactly which objectIds the server rejects.
    for (const game of gamesChunk) {
      const single = await HydraApi.post("/profile/games/batch", [
        toPayload(game),
      ])
        .then(() => true)
        .catch(() => false);

      if (!single) {
        logger.warn(
          `[uploadGamesBatch] server rejected ${game.shop}:${game.objectId} ("${game.title}")`
        );
      }
    }
  }

  // Upload local catalogue/import games to the cloud so their achievements can
  // sync to the Hydra profile — but DO NOT auto-materialize cloud games back
  // into the local library on login. Catalogue/Playnite/Exophase imports live
  // in the cloud purely for achievement sync; they should only appear in the
  // local library when the user explicitly adds them (or, for owned games, when
  // the platform sync re-adds them). This prevents deleted/excluded imports from
  // being restored on every login. Owned games (libraryOrigin "sync") are never
  // uploaded here and are re-synced from their platform on each login.
  await mergeWithRemoteGames({ createMissing: false });

  AchievementWatcherManager.preSearchAchievements();

  if (WindowManager.mainWindow)
    WindowManager.sendToAppWindows("on-library-batch-complete");
};
