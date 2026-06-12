import { registerEvent } from "../register-event";
import {
  db,
  gamesSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import type { UserPreferences } from "@types";
import {
  getLegendaryGames,
  getLegendaryGameCoverUrl,
} from "@main/services/legendary";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { generateMissingMetadataInternal } from "./generate-missing-metadata";
import { findGameByTitle } from "@main/helpers/find-game-by-title";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";

const syncEpicLibrary = async (_event: Electron.IpcMainInvokeEvent) => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const games = await getLegendaryGames(prefs?.legendaryBinaryPath);

  let added = 0;
  const addedGames: Array<{
    title: string;
    coverUrl: string | null;
    what: string;
  }> = [];

  const excludedGames = await getExcludedGames();

  for (const epicGame of games) {
    const objectId = epicGame.app_name;
    const gameKey = levelKeys.game("epic", objectId);

    if (isGameExcluded(excludedGames, "epic", objectId, epicGame.app_title)) {
      continue;
    }

    const epicPlaytimeMs = (epicGame.playtime ?? 0) * 60 * 1000;

    const existing = await gamesSublevel.get(gameKey).catch(() => null);
    if (existing && !existing.isDeleted) {
      const updates: Partial<typeof existing> = {};
      // Update playtime if Epic reports more than we currently have
      if (epicPlaytimeMs > (existing.playTimeInMilliseconds ?? 0)) {
        updates.playTimeInMilliseconds = epicPlaytimeMs;
        updates.lastTimePlayed = existing.lastTimePlayed ?? new Date();
      }
      // Owned on Epic — make sure it's classified as synced
      if (existing.libraryOrigin !== "sync") {
        updates.libraryOrigin = "sync";
      }
      if (Object.keys(updates).length > 0) {
        await gamesSublevel.put(gameKey, { ...existing, ...updates });
      }
      continue;
    }

    // Check for same game from another shop — attach as alternativeShop instead of duplicating
    const titleMatch = await findGameByTitle(epicGame.app_title);
    if (titleMatch) {
      const [matchKey, matchGame] = titleMatch;
      const alreadyLinked = matchGame.alternativeShops?.some(
        (s) => s.shop === "epic" && s.objectId === objectId
      );
      if (!alreadyLinked) {
        await gamesSublevel.put(matchKey, {
          ...matchGame,
          alternativeShops: [
            ...(matchGame.alternativeShops ?? []),
            {
              shop: "epic",
              objectId,
              executablePath: epicGame.is_installed
                ? `legendary://run/${objectId}`
                : null,
            },
          ],
        });
      }
      continue; // Don't create a duplicate entry
    }

    const coverUrl = getLegendaryGameCoverUrl(epicGame);
    const executablePath = epicGame.is_installed
      ? `legendary://run/${objectId}`
      : null;

    const assets = await fetchBestAssets("epic", objectId, epicGame.app_title, {
      iconUrl: coverUrl,
      coverImageUrl: coverUrl,
      libraryHeroImageUrl: coverUrl,
    });

    const game = {
      title: epicGame.app_title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId,
      shop: "epic" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: epicPlaytimeMs,
      lastTimePlayed: epicPlaytimeMs > 0 ? new Date() : null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "sync" as const,
      executablePath,
    };

    await gamesSublevel.put(gameKey, game);
    await gamesShopAssetsSublevel
      .put(gameKey, {
        objectId,
        shop: "epic" as const,
        title: epicGame.app_title,
        iconUrl: assets.iconUrl,
        coverImageUrl: assets.coverImageUrl,
        libraryImageUrl: assets.libraryImageUrl,
        libraryHeroImageUrl: assets.libraryHeroImageUrl,
        logoImageUrl: assets.logoImageUrl,
        logoPosition: assets.logoPosition,
        downloadSources: assets.downloadSources ?? [],
        updatedAt: Date.now(),
      })
      .catch(() => {});
    await createGame(game).catch(() => {});
    await deduplicateTitle(epicGame.app_title).catch(() => {});

    added++;
    const gotHydraAssets = Boolean(
      assets.coverImageUrl || assets.libraryHeroImageUrl
    );
    addedGames.push({
      title: epicGame.app_title,
      coverUrl: assets.coverImageUrl ?? assets.libraryHeroImageUrl ?? coverUrl,
      what: gotHydraAssets
        ? "Cover fetched from Hydra API (Steam catalogue)"
        : "Added — no Hydra API match found",
    });
  }

  logger.log(`Epic library sync complete: ${added} games added`);
  void generateMissingMetadataInternal();
  return { total: games.length, added, addedGames };
};

registerEvent("syncEpicLibrary", syncEpicLibrary);

export const syncEpicLibraryInternal = () =>
  syncEpicLibrary({} as Electron.IpcMainInvokeEvent);
