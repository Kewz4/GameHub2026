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
  getGameHubMeta,
} from "@main/level";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import { platformToSystem, systemFromObjectId } from "@main/helpers";
import {
  isCuratedRiotGame,
  buildRiotShopDetails,
} from "@main/helpers/riot-metadata";
import type { EmulatorSystem } from "@types";

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

  // Launchbox (console/emulated) games: serve data from the local gamehub-meta
  // sublevel (SteamGridDB art + IGDB description) — no Steam lookup needed.
  if (shop === "launchbox") {
    const gameKey = levelKeys.game(shop, objectId);
    const gameEntry = await gamesSublevel.get(gameKey).catch(() => null);
    const gameAssets = await gamesShopAssetsSublevel
      .get(gameKey)
      .catch(() => null);

    // Derive the system from the objectId first (minerva:/local- prefixes carry
    // it), then fall back to the stored platform for opaque launchbox ids.
    const system = (systemFromObjectId(objectId) ??
      platformToSystem(gameEntry?.platform) ??
      "") as EmulatorSystem;

    // Minerva ids embed the already-normalized title as the trailing segment,
    // so meta resolves even for games that are not in the library yet.
    const objectIdTitle = objectId.startsWith("minerva:")
      ? objectId.split(":").slice(2).join(":") || null
      : null;
    const title =
      gameAssets?.title ?? gameEntry?.title ?? objectIdTitle ?? null;

    const metaTitle = title ?? objectIdTitle;
    const meta =
      metaTitle && system ? await getGameHubMeta(system, metaTitle) : null;

    if (!title && !meta) return null;

    const description = meta?.description ?? "";
    const assets: ShopDetailsWithAssets["assets"] = {
      objectId,
      shop,
      title: title ?? meta?.title ?? "",
      coverImageUrl: gameAssets?.coverImageUrl ?? meta?.coverImageUrl ?? null,
      libraryImageUrl:
        gameAssets?.libraryImageUrl ?? meta?.libraryImageUrl ?? null,
      libraryHeroImageUrl:
        gameAssets?.libraryHeroImageUrl ?? meta?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? meta?.logoImageUrl ?? null,
      iconUrl: gameAssets?.iconUrl ?? meta?.iconUrl ?? null,
      logoPosition: null,
      downloadSources: [],
    };

    return {
      objectId,
      name: title ?? meta?.title ?? objectId,
      steam_appid: 0,
      detailed_description: description,
      about_the_game: description,
      short_description: description,
      developers: [],
      publishers: [],
      genres: (meta?.genres ?? []).map((g, i) => ({
        id: String(i + 1),
        name: g,
      })),
      supported_languages: "English",
      screenshots: [],
      movies: [],
      pc_requirements: { minimum: "", recommended: "" },
      mac_requirements: { minimum: "", recommended: "" },
      linux_requirements: { minimum: "", recommended: "" },
      release_date: {
        coming_soon: false,
        date: meta?.releaseYear ? String(meta.releaseYear) : "",
      },
      content_descriptors: { ids: [] },
      assets,
    } as ShopDetailsWithAssets;
  }

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
