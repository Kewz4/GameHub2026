import type { Game } from "@types";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { reconcilePlayniteAbsolutePlaytimeAcknowledgement } from "../playnite-playtime-policy";
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

  const response = await HydraApi.post<{
    id: string;
    playTimeInMilliseconds: number;
    lastTimePlayed: Date | null;
    createdAt?: string | null;
  }>(`/profile/games`, {
    objectId: game.objectId,
    playTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    shop: game.shop,
    lastTimePlayed: game.lastTimePlayed,
  });

  const gameKey = levelKeys.game(game.shop, game.objectId);
  const current = await gamesSublevel.get(gameKey).catch(() => null);
  const latest = current ?? game;
  const hadPendingAbsoluteCorrection =
    game.pendingAbsolutePlayTimeInMilliseconds != null;
  const pendingAbsolute = latest.pendingAbsolutePlayTimeInMilliseconds;

  // A create/upsert response may represent an older cloud record. When this
  // game carries an imported absolute correction, preserve the local value and
  // durable marker until the dedicated absolute endpoint acknowledges it.
  await gamesSublevel.put(gameKey, {
    ...latest,
    remoteId: response.id,
    addedToLibraryAt:
      latest.addedToLibraryAt ??
      (response.createdAt ? new Date(response.createdAt) : new Date()),
    playTimeInMilliseconds:
      hadPendingAbsoluteCorrection || pendingAbsolute != null
        ? latest.playTimeInMilliseconds
        : response.playTimeInMilliseconds,
    lastTimePlayed:
      hadPendingAbsoluteCorrection || pendingAbsolute != null
        ? latest.lastTimePlayed
        : response.lastTimePlayed,
    pendingAbsolutePlayTimeInMilliseconds: pendingAbsolute ?? null,
    unsyncedDeltaPlayTimeInMilliseconds:
      pendingAbsolute != null
        ? (latest.unsyncedDeltaPlayTimeInMilliseconds ?? 0)
        : 0,
  });

  if (pendingAbsolute != null) {
    const acknowledged = await HydraApi.put(
      `/profile/games/${game.shop}/${game.objectId}/playtime`,
      { playTimeInSeconds: Math.trunc(pendingAbsolute / 1000) }
    )
      .then(() => true)
      .catch((error) => {
        logger.warn(
          `[createGame] absolute playtime sync deferred for ${game.shop}:${game.objectId}`,
          error
        );
        return false;
      });

    if (acknowledged) {
      const afterCreate = await gamesSublevel.get(gameKey).catch(() => null);
      if (afterCreate) {
        const acknowledgement =
          reconcilePlayniteAbsolutePlaytimeAcknowledgement(
            afterCreate.playTimeInMilliseconds,
            afterCreate.pendingAbsolutePlayTimeInMilliseconds,
            pendingAbsolute
          );
        if (acknowledgement.action !== "ignore") {
          await gamesSublevel.put(gameKey, {
            ...afterCreate,
            pendingAbsolutePlayTimeInMilliseconds:
              acknowledgement.pendingAbsolutePlayTimeInMilliseconds,
            unsyncedDeltaPlayTimeInMilliseconds:
              acknowledgement.unsyncedDeltaPlayTimeInMilliseconds,
          });
        }
      }
    }
  }

  return response;
};
