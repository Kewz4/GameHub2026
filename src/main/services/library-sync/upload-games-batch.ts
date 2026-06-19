import { chunk } from "lodash-es";
import { HydraApi } from "../hydra-api";
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

  const gamesChunks = chunk(games, 30);

  for (const chunk of gamesChunks) {
    await HydraApi.post(
      "/profile/games/batch",
      chunk.map((game) => {
        return {
          objectId: game.objectId,
          playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds),
          shop: game.shop,
          lastTimePlayed: game.lastTimePlayed,
          isFavorite: game.favorite,
          isPinned: game.isPinned ?? false,
        };
      })
    ).catch(() => {});
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
