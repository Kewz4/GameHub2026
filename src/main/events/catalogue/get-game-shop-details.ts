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
import {
  gamehubMetaSublevel,
  gamehubMetaKey,
  normalizeMetaTitle,
} from "@main/level/sublevels/gamehub-meta";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import { displayRomTitle } from "@main/services/emulators/parse-rom-filename";
import { platformToSystem, systemFromObjectId } from "@main/helpers";
import { igdb, IGDB_PLATFORM_IDS } from "@main/services/igdb";
import {
  isCuratedRiotGame,
  buildRiotShopDetails,
} from "@main/helpers/riot-metadata";
import type { EmulatorSystem } from "@types";

/**
 * Convert a console game's display title into the form IGDB indexes: drop a
 * trailing/leading article, collapse the " - subtitle" separator to a space,
 * and strip parenthetical/edition/region noise, so "The Legend of Zelda -
 * Ocarina of Time 3D" queries as "Legend of Zelda Ocarina of Time 3D".
 */
const igdbQueryTitle = (title: string): string =>
  title
    .replace(/,\s*(the|a|an)\b/gi, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+-\s+/g, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Console/emulated games aren't on Steam, so fetch their description straight
 * from IGDB (same source the offline metadata generator uses) when the bundled
 * dataset has no summary. Also fills genres/release year when absent. Persists
 * the result back into the local gamehub-meta so it's cached for next time.
 */
const fetchConsoleMetaFromIgdb = async (
  system: EmulatorSystem,
  title: string
): Promise<{
  description: string;
  genres: string[];
  releaseYear: number | null;
} | null> => {
  const platformId = IGDB_PLATFORM_IDS[system];
  const game = await igdb
    .searchGame(igdbQueryTitle(title), platformId)
    .catch(() => null);
  if (!game?.summary) return null;

  const releaseYear = game.first_release_date
    ? new Date(game.first_release_date * 1000).getUTCFullYear()
    : null;
  const genres = (game.genres ?? []).map((g) => g.name).filter(Boolean);

  // Cache back into the local dataset (best-effort) so we don't hit IGDB again.
  const key = gamehubMetaKey(system, normalizeMetaTitle(title));
  const existing = await gamehubMetaSublevel.get(key).catch(() => null);
  await gamehubMetaSublevel
    .put(key, {
      title,
      coverImageUrl: null,
      libraryImageUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      iconUrl: null,
      ...existing,
      description: game.summary,
      genres: existing?.genres?.length ? existing.genres : genres,
      releaseYear: existing?.releaseYear ?? releaseYear,
    })
    .catch(() => {});

  return { description: game.summary, genres, releaseYear };
};

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

    // Prefer a real, human title for display. When the game isn't in the
    // library yet the only title we have is the normalized objectId slug
    // (e.g. "supersmashbrosforwiiu") — the meta's proper title wins over it.
    const displayTitle =
      gameAssets?.title ??
      gameEntry?.title ??
      (meta?.title ? displayRomTitle(meta.title) : null) ??
      title ??
      objectId;

    // The bundled metadata has no IGDB summary for some titles (e.g. Pokemon
    // Dash). Fetch it straight from IGDB (console games aren't on Steam), and
    // borrow genres/release year too when the local dataset lacks them.
    let description = meta?.description ?? "";
    let genres = meta?.genres ?? [];
    let releaseYear = meta?.releaseYear ?? null;
    if (!description.trim() && system) {
      const fetched = await fetchConsoleMetaFromIgdb(
        system,
        displayTitle
      ).catch(() => null);
      if (fetched) {
        description = fetched.description;
        if (genres.length === 0) genres = fetched.genres;
        releaseYear = releaseYear ?? fetched.releaseYear;
      }
    }
    const assets: ShopDetailsWithAssets["assets"] = {
      objectId,
      shop,
      title: displayTitle,
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
      name: displayTitle,
      steam_appid: 0,
      detailed_description: description,
      about_the_game: description,
      short_description: description,
      developers: [],
      publishers: [],
      genres: genres.map((g, i) => ({
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
        date: releaseYear ? String(releaseYear) : "",
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
