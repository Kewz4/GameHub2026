import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import {
  db,
  gamesSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import type { GameShop, Game, UserPreferences } from "@types";
import fs from "node:fs";

/** Synced games would reappear on the next platform sync, so removal also
 * adds them to the exclusion list (manageable in settings). */
const addToExclusionList = async (game: Game): Promise<void> => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const existing = prefs?.excludedGames ?? [];
  if (
    existing.some((g) => g.shop === game.shop && g.objectId === game.objectId)
  ) {
    return;
  }

  await db.put(
    levelKeys.userPreferences,
    {
      ...(prefs ?? {}),
      excludedGames: [
        ...existing,
        {
          shop: game.shop,
          objectId: game.objectId,
          title: game.title,
          excludedAt: new Date().toISOString(),
        },
      ],
    },
    { valueEncoding: "json" }
  );
};

const collectAssetPathsToDelete = (game: Game): string[] => {
  const assetPathsToDelete: string[] = [];

  const assetUrls =
    game.shop === "custom"
      ? [game.iconUrl, game.logoImageUrl, game.libraryHeroImageUrl]
      : [game.customIconUrl, game.customLogoImageUrl, game.customHeroImageUrl];

  for (const url of assetUrls) {
    if (url?.startsWith("local:")) {
      assetPathsToDelete.push(url.replace("local:", ""));
    }
  }

  return assetPathsToDelete;
};

const updateGameAsDeleted = async (
  game: Game,
  gameKey: string
): Promise<void> => {
  const updatedGame = {
    ...game,
    isDeleted: true,
    executablePath: null,
    ...(game.shop !== "custom" && {
      customIconUrl: null,
      customLogoImageUrl: null,
      customHeroImageUrl: null,
    }),
  };

  await gamesSublevel.put(gameKey, updatedGame);
};

const resetShopAssets = async (gameKey: string): Promise<void> => {
  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const resetAssets = {
      ...existingAssets,
      title: existingAssets.title,
    };
    await gamesShopAssetsSublevel.put(gameKey, resetAssets);
  }
};

const deleteAssetFiles = async (
  assetPathsToDelete: string[]
): Promise<void> => {
  if (assetPathsToDelete.length === 0) return;

  for (const assetPath of assetPathsToDelete) {
    try {
      if (fs.existsSync(assetPath)) {
        await fs.promises.unlink(assetPath);
      }
    } catch (error) {
      logger.warn(`Failed to delete asset ${assetPath}:`, error);
    }
  }
};

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  const assetPathsToDelete = collectAssetPathsToDelete(game);

  await updateGameAsDeleted(game, gameKey);

  if (game.shop !== "custom") {
    await resetShopAssets(gameKey);
  }

  if (game.remoteId) {
    HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
  }

  await deleteAssetFiles(assetPathsToDelete);

  if (game.libraryOrigin === "sync") {
    await addToExclusionList(game).catch((err) =>
      logger.warn("Failed to add removed game to exclusion list", err)
    );
  }
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
