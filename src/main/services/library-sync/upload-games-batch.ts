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

  await mergeWithRemoteGames();

  AchievementWatcherManager.preSearchAchievements();

  if (WindowManager.mainWindow)
    WindowManager.sendToAppWindows("on-library-batch-complete");
};
