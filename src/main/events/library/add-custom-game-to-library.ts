import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { randomUUID } from "node:crypto";
import type { GameShop, CatalogueSearchResult } from "@types";
import { HydraApi } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";

const addCustomGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string,
  coverImageUrl?: string,
  libraryImageUrl?: string
) => {
  const objectId = randomUUID();
  const shop: GameShop = "custom";
  const gameKey = levelKeys.game(shop, objectId);

  const existingGames = await gamesSublevel.iterator().all();
  const existingByPath = existingGames.find(
    ([_key, game]) => game.executablePath === executablePath && !game.isDeleted
  );

  if (existingByPath) {
    throw new Error(
      "A game with this executable path already exists in your library"
    );
  }

  // Check local library for a game with the same (edition-normalized) title first
  const titleNorm = normalizeGameTitle(title);
  const existingByTitle = existingGames.find(
    ([_key, game]) =>
      !game.isDeleted && normalizeGameTitle(game.title) === titleNorm
  );

  if (existingByTitle) {
    const [existingKey, existingGame] = existingByTitle;
    const mergedGame = {
      ...existingGame,
      executablePath,
      iconUrl: iconUrl || existingGame.iconUrl || null,
      logoImageUrl: logoImageUrl || existingGame.logoImageUrl || null,
      libraryHeroImageUrl:
        libraryHeroImageUrl || existingGame.libraryHeroImageUrl || null,
    };
    await gamesSublevel.put(existingKey, mergedGame);
    // Dedup in case there are other duplicate title entries
    await deduplicateTitle(title).catch(() => {});
    return mergedGame;
  }

  // Search the Hydra API catalogue by title — if found, use that entry's
  // objectId/shop so the game gets full catalogue metadata (achievements, stats, etc.)
  try {
    const catalogueResponse = await HydraApi.post<{
      edges: CatalogueSearchResult[];
      count: number;
    }>(
      "/catalogue/search",
      {
        title,
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
    );

    const match = catalogueResponse?.edges?.find(
      (r) => normalizeGameTitle(r.title) === titleNorm
    );

    if (match) {
      const catalogueKey = levelKeys.game(match.shop, match.objectId);
      // Check if that catalogue entry already exists in the library
      const existingCatalogue = await gamesSublevel
        .get(catalogueKey)
        .catch(() => null);
      if (existingCatalogue && !existingCatalogue.isDeleted) {
        // Merge exe into existing catalogue entry
        const merged = {
          ...existingCatalogue,
          executablePath,
          iconUrl: iconUrl || existingCatalogue.iconUrl || null,
          logoImageUrl: logoImageUrl || existingCatalogue.logoImageUrl || null,
          libraryHeroImageUrl:
            libraryHeroImageUrl ||
            existingCatalogue.libraryHeroImageUrl ||
            null,
        };
        await gamesSublevel.put(catalogueKey, merged);
        await deduplicateTitle(match.title).catch(() => {});
        return merged;
      }
      // Create a new entry using the catalogue's objectId/shop
      const catalogueGame = {
        title: match.title,
        iconUrl: iconUrl || null,
        logoImageUrl: logoImageUrl || null,
        libraryHeroImageUrl: libraryHeroImageUrl || null,
        objectId: match.objectId,
        shop: match.shop,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        libraryOrigin: "custom" as const,
        executablePath,
        launchOptions: null,
        favorite: false,
        automaticCloudSync: true,
        hasManuallyUpdatedPlaytime: false,
      };
      const catalogueAssets = {
        updatedAt: Date.now(),
        objectId: match.objectId,
        shop: match.shop,
        title: match.title,
        iconUrl: iconUrl || null,
        libraryHeroImageUrl: libraryHeroImageUrl || match.libraryImageUrl || "",
        libraryImageUrl: match.libraryImageUrl || iconUrl || "",
        logoImageUrl: logoImageUrl || "",
        logoPosition: null,
        coverImageUrl: match.libraryImageUrl || iconUrl || "",
        downloadSources: [],
      };
      await gamesShopAssetsSublevel.put(catalogueKey, catalogueAssets);
      await gamesSublevel.put(catalogueKey, catalogueGame);
      await deduplicateTitle(match.title).catch(() => {});
      return catalogueGame;
    }
  } catch {
    // Catalogue search failed — fall through to custom entry creation
  }

  // For truly custom (no catalogue match): try to enrich with SGDB artwork.
  // Caller-supplied assets (from resolveCustomGameInfo) take priority.
  const bestAssets = await fetchBestAssets("custom", objectId, title, {
    iconUrl: iconUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || null,
    logoImageUrl: logoImageUrl || null,
    coverImageUrl: coverImageUrl || null,
    libraryImageUrl: libraryImageUrl || null,
  });

  const assets = {
    updatedAt: Date.now(),
    objectId,
    shop,
    title,
    iconUrl: iconUrl || bestAssets.iconUrl,
    libraryHeroImageUrl: libraryHeroImageUrl || bestAssets.libraryHeroImageUrl,
    libraryImageUrl: libraryImageUrl || bestAssets.libraryImageUrl,
    logoImageUrl: logoImageUrl || bestAssets.logoImageUrl,
    logoPosition: null,
    coverImageUrl: coverImageUrl || bestAssets.coverImageUrl,
    downloadSources: [],
  };
  await gamesShopAssetsSublevel.put(gameKey, assets);

  const game = {
    title,
    iconUrl: iconUrl || bestAssets.iconUrl,
    logoImageUrl: logoImageUrl || bestAssets.logoImageUrl,
    libraryHeroImageUrl: libraryHeroImageUrl || bestAssets.libraryHeroImageUrl,
    objectId,
    shop,
    remoteId: null,
    isDeleted: false,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    addedToLibraryAt: new Date(),
    libraryOrigin: "custom" as const,
    executablePath,
    launchOptions: null,
    favorite: false,
    automaticCloudSync: true,
    hasManuallyUpdatedPlaytime: false,
  };

  await gamesSublevel.put(gameKey, game);
  await deduplicateTitle(title).catch(() => {});

  return game;
};

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
