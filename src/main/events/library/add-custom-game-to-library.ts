import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { randomUUID } from "node:crypto";
import type { GameShop, CatalogueSearchResult } from "@types";
import { HydraApi } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import { normalizeExplicitSteamAppId } from "./custom-game-catalogue-match";

interface CatalogueMatch {
  objectId: string;
  shop: GameShop;
  title: string;
  libraryImageUrl?: string | null;
}

export const addCustomGameToLibraryInternal = async (
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string,
  coverImageUrl?: string,
  libraryImageUrl?: string,
  matchedSteamObjectId?: string | null
) => {
  const objectId = randomUUID();
  const shop: GameShop = "custom";
  const gameKey = levelKeys.game(shop, objectId);
  const explicitSteamObjectId =
    normalizeExplicitSteamAppId(matchedSteamObjectId);

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

  if (existingByTitle && !explicitSteamObjectId) {
    const [existingKey, existingGame] = existingByTitle;
    const mergedGame = {
      ...existingGame,
      executablePath,
      isInstalledLocally: true,
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

  // Search the catalogue by title when the user did not choose a specific
  // Steam result. An explicit selection is canonical and never depends on a
  // second fuzzy search returning the same result.
  let match: CatalogueMatch | undefined = explicitSteamObjectId
    ? {
        objectId: explicitSteamObjectId,
        shop: "steam",
        title,
        libraryImageUrl,
      }
    : undefined;

  if (!match) {
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

      match = catalogueResponse?.edges?.find(
        (result) => normalizeGameTitle(result.title) === titleNorm
      );
    } catch {
      // Catalogue lookup is optional for an unmatched manual game.
    }
  }

  if (match) {
    const catalogueKey = levelKeys.game(match.shop, match.objectId);
    const existingCatalogue = await gamesSublevel
      .get(catalogueKey)
      .catch(() => null);

    if (existingCatalogue) {
      const merged = {
        ...existingCatalogue,
        isDeleted: false,
        isInstalledLocally: true,
        libraryOrigin: explicitSteamObjectId
          ? ("custom" as const)
          : (existingCatalogue.libraryOrigin ?? ("custom" as const)),
        executablePath,
        iconUrl: iconUrl || existingCatalogue.iconUrl || null,
        logoImageUrl: logoImageUrl || existingCatalogue.logoImageUrl || null,
        libraryHeroImageUrl:
          libraryHeroImageUrl || existingCatalogue.libraryHeroImageUrl || null,
      };
      await gamesSublevel.put(catalogueKey, merged);
      await deduplicateTitle(match.title).catch(() => {});
      return merged;
    }

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
      isInstalledLocally: true,
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
      coverImageUrl: coverImageUrl || match.libraryImageUrl || iconUrl || "",
      downloadSources: [],
    };
    await gamesShopAssetsSublevel.put(catalogueKey, catalogueAssets);
    await gamesSublevel.put(catalogueKey, catalogueGame);
    await deduplicateTitle(match.title).catch(() => {});
    return catalogueGame;
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
    isInstalledLocally: true,
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

const addCustomGameToLibrary = (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string,
  coverImageUrl?: string,
  libraryImageUrl?: string,
  matchedSteamObjectId?: string | null
) =>
  addCustomGameToLibraryInternal(
    title,
    executablePath,
    iconUrl,
    logoImageUrl,
    libraryHeroImageUrl,
    coverImageUrl,
    libraryImageUrl,
    matchedSteamObjectId
  );

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
