import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

import { CLOUD_SAVE_EXECUTABLE_MISSING_ERROR } from "./executable-path-guard";

/**
 * Cloud-save discovery is not inherently executable-bound. Store URI games,
 * custom launch commands, and emulated titles may all have valid save roots
 * without a filesystem executable. Keep the compatibility guard name used by
 * the V2 state machine, but only require that the library game still exists.
 */
export const assertCloudSaveExecutableExists = async (
  objectId: string,
  shop: GameShop
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  if (!game) throw new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR);
  return game;
};
