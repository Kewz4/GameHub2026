import { registerEvent } from "../register-event";
import { getGamePassCatalog } from "@main/services/xbox";
import { gamesSublevel, levelKeys, db } from "@main/level";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import type { UserPreferences } from "@types";
import { syncXboxGameAchievements } from "@main/services/achievements/get-xbox-achievements";
import { findGameByTitle } from "@main/helpers/find-game-by-title";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { generateMissingMetadataInternal } from "./generate-missing-metadata";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";

const syncGamePassLibrary = async () => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  if (!prefs?.xboxXstsToken || !prefs?.xboxUserHash) {
    throw new Error("Xbox account not connected. Sign in first.");
  }

  const games = await getGamePassCatalog(
    prefs.xboxUserHash,
    prefs.xboxXstsToken
  );

  let added = 0;

  const excludedGames = await getExcludedGames();

  for (const xboxGame of games) {
    const gameKey = levelKeys.game("xbox", xboxGame.productId);

    if (
      isGameExcluded(excludedGames, "xbox", xboxGame.productId, xboxGame.title)
    ) {
      continue;
    }
    const existing = await gamesSublevel.get(gameKey).catch(() => null);
    if (existing && !existing.isDeleted) {
      // Owned on Xbox — make sure it's classified as synced
      if (existing.libraryOrigin !== "sync") {
        await gamesSublevel.put(gameKey, {
          ...existing,
          libraryOrigin: "sync",
        });
      }
      continue;
    }

    // Check for same game from another shop — attach as alternativeShop instead of duplicating
    const titleMatch = await findGameByTitle(xboxGame.title);
    if (titleMatch) {
      const [matchKey, matchGame] = titleMatch;
      const alreadyLinked = matchGame.alternativeShops?.some(
        (s) => s.shop === "xbox" && s.objectId === xboxGame.productId
      );
      if (!alreadyLinked) {
        await gamesSublevel.put(matchKey, {
          ...matchGame,
          alternativeShops: [
            ...(matchGame.alternativeShops ?? []),
            {
              shop: "xbox",
              objectId: xboxGame.productId,
              executablePath: `msxbox://game/?productId=${xboxGame.productId}`,
            },
          ],
        });
      }
      continue; // Don't create a duplicate entry
    }

    const assets = await fetchBestAssets(
      "xbox",
      xboxGame.productId,
      xboxGame.title,
      {
        iconUrl: xboxGame.coverUrl ?? null,
        coverImageUrl: xboxGame.coverUrl ?? null,
        libraryHeroImageUrl: xboxGame.coverUrl ?? null,
      }
    );

    const game = {
      title: xboxGame.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId: xboxGame.productId,
      shop: "xbox" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "sync" as const,
      executablePath: `msxbox://game/?productId=${xboxGame.productId}`,
      xboxTitleId: xboxGame.titleId ?? null,
    } as any;

    await gamesSublevel.put(gameKey, game);
    await createGame(game).catch(() => {});
    await deduplicateTitle(xboxGame.title).catch(() => {});
    added++;

    // Sync achievements for this game if titleId is available
    if (xboxGame.titleId) {
      syncXboxGameAchievements(xboxGame.productId, xboxGame.titleId).catch(
        () => {}
      );
    }
  }

  logger.log(`Xbox Game Pass sync complete: ${added} games added`);
  void generateMissingMetadataInternal();
  return { total: games.length, added };
};

registerEvent("syncGamePassLibrary", syncGamePassLibrary);

export const syncGamePassLibraryInternal = () => syncGamePassLibrary();
