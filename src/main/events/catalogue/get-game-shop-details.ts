import { getSteamAppDetails, logger, HydraApi } from "@main/services";

import type {
  ShopDetails,
  GameShop,
  ShopDetailsWithAssets,
  CatalogueSearchResult,
} from "@types";

import { registerEvent } from "../register-event";
import {
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import {
  isCuratedRiotGame,
  buildRiotShopDetails,
} from "@main/helpers/riot-metadata";

const getLocalizedSteamAppDetails = async (
  objectId: string,
  language: string
): Promise<ShopDetails | null> => {
  if (language === "english") {
    return getSteamAppDetails(objectId, language);
  }

  return getSteamAppDetails(objectId, language);
};

const getGameShopDetails = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  language: string
): Promise<ShopDetailsWithAssets | null> => {
  if (shop === "custom") return null;

  // For non-Steam games: find the canonical Steam equivalent via the catalogue
  // so the game detail page can show descriptions, publisher info, etc.
  if (shop !== "steam") {
    try {
      // First, try the Hydra API assets for this exact game to get its title
      const gameKey = levelKeys.game(shop, objectId);
      const gameEntry = await gamesSublevel.get(gameKey).catch(() => null);
      const gameAssets = await gamesShopAssetsSublevel
        .get(gameKey)
        .catch(() => null);

      // Riot titles (LoL, VALORANT, LoR) have empty/broken Hydra catalogue
      // entries — bypass the catalogue entirely and serve curated metadata
      // paired with the SteamGridDB artwork captured at sync time.
      if (shop === "riot" && isCuratedRiotGame(objectId)) {
        const riotDetails = buildRiotShopDetails(
          objectId,
          gameAssets ?? null,
          gameEntry?.title
        );
        if (riotDetails) return riotDetails;
      }

      const titleToSearch = gameAssets?.title ?? gameEntry?.title ?? objectId;

      // Search the Hydra catalogue for a Steam match by title
      const titleNorm = normalizeGameTitle(titleToSearch);
      const catalogueResp = await HydraApi.post<{
        edges: CatalogueSearchResult[];
        count: number;
      }>(
        "/catalogue/search",
        {
          title: titleToSearch,
          sortBy: "popularity",
          sortOrder: "desc",
          downloadSourceFingerprints: [],
          tags: [],
          publishers: [],
          genres: [],
          developers: [],
          protondbSupportBadges: [],
          deckCompatibility: [],
          take: 5,
          skip: 0,
        },
        { needsAuth: false }
      ).catch(() => null);

      const steamMatch =
        catalogueResp?.edges?.find(
          (r) => r.shop === "steam" && normalizeGameTitle(r.title) === titleNorm
        ) ?? catalogueResp?.edges?.find((r) => r.shop === "steam");

      if (steamMatch) {
        const steamObjectId = steamMatch.objectId;
        const cachedDetails = await gamesShopCacheSublevel
          .get(levelKeys.gameShopCacheItem("steam", steamObjectId, language))
          .catch(() => null);
        const steamAssets = await gamesShopAssetsSublevel
          .get(levelKeys.game("steam", steamObjectId))
          .catch(() => null);

        const details = cachedDetails
          ? { ...cachedDetails, assets: steamAssets ?? gameAssets ?? null }
          : await getSteamAppDetails(steamObjectId, language)
              .then((r) => {
                if (r) {
                  // Cache for next time
                  gamesShopCacheSublevel
                    .put(
                      levelKeys.gameShopCacheItem(
                        "steam",
                        steamObjectId,
                        language
                      ),
                      r
                    )
                    .catch(() => {});
                  return { ...r, assets: steamAssets ?? gameAssets ?? null };
                }
                return null;
              })
              .catch(() => null);

        if (details) {
          // Override the name with the actual game title from our library
          (details as ShopDetails).name =
            gameAssets?.title ?? gameEntry?.title ?? details.name;
          return {
            ...details,
            assets: steamAssets ?? gameAssets ?? null,
          } as ShopDetailsWithAssets;
        }
      }
    } catch (err) {
      logger.warn(
        `getGameShopDetails: non-Steam fallback failed for ${shop}/${objectId}`,
        err
      );
    }
    return null;
  }

  if (shop === "steam") {
    const [cachedData, cachedAssets] = await Promise.all([
      gamesShopCacheSublevel.get(
        levelKeys.gameShopCacheItem(shop, objectId, language)
      ),
      gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
    ]);

    const appDetails = getLocalizedSteamAppDetails(objectId, language).then(
      (result) => {
        if (result) {
          result.name = cachedAssets?.title ?? result.name;

          gamesShopCacheSublevel
            .put(levelKeys.gameShopCacheItem(shop, objectId, language), result)
            .catch((err) => {
              logger.error("Could not cache game details", err);
            });

          return {
            ...result,
            assets: cachedAssets ?? null,
          };
        }

        return null;
      }
    );

    if (cachedData) {
      return {
        ...cachedData,
        assets: cachedAssets ?? null,
      };
    }

    return appDetails;
  }

  throw new Error("Not implemented");
};

registerEvent("getGameShopDetails", getGameShopDetails);
