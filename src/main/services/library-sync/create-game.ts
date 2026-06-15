import type { Game } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesSublevel, levelKeys } from "@main/level";

export const createGame = async (game: Game) => {
  if (game.shop === "custom") {
    return;
  }
  // Platform-owned games are re-synced from the platform on each login;
  // they must not be uploaded to the Hydra cloud library.
  if (game.libraryOrigin === "sync") {
    return;
  }

  return HydraApi.post(`/profile/games`, {
    objectId: game.objectId,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  }).then((response) => {
    const {
      id: remoteId,
      playTimeInMilliseconds,
      lastTimePlayed,
      createdAt,
    } = response;

    gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
      ...game,
      remoteId,
      addedToLibraryAt:
        game.addedToLibraryAt ?? (createdAt ? new Date(createdAt) : new Date()),
      playTimeInMilliseconds,
      lastTimePlayed,
    });
  });
};
