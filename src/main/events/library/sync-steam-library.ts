import { registerEvent } from "../register-event";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { getSteamOwnedGames } from "@main/services/steam-account";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { generateMissingMetadataInternal } from "./generate-missing-metadata";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";

const syncSteamLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  steamId: string,
  apiKey?: string
) => {
  const ownedGames = await getSteamOwnedGames(steamId, apiKey);

  let added = 0;

  const excludedGames = await getExcludedGames();

  for (const ownedGame of ownedGames) {
    const objectId = String(ownedGame.appid);
    const gameKey = levelKeys.game("steam", objectId);

    if (isGameExcluded(excludedGames, "steam", objectId, ownedGame.name)) {
      continue;
    }

    const existing = await gamesSublevel.get(gameKey).catch(() => null);
    if (existing && !existing.isDeleted) {
      // This game is owned on Steam — make sure it's classified as synced,
      // even if it was originally added from the catalog.
      if (existing.libraryOrigin !== "sync") {
        await gamesSublevel.put(gameKey, {
          ...existing,
          libraryOrigin: "sync",
        });
      }
      // Already have this exact Steam entry — still dedup by title to collapse
      // any custom/other-shop entries with the same name
      await deduplicateTitle(ownedGame.name).catch(() => {});
      continue;
    }

    const gameAssets = await gamesShopAssetsSublevel
      .get(gameKey)
      .catch(() => null);

    const executablePath = `steam://run/${objectId}`;
    const steamIconUrl = ownedGame.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${objectId}/${ownedGame.img_icon_url}.jpg`
      : null;
    const steamHeroUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${objectId}/library_hero.jpg`;

    // Fetch best assets in background so sync is not blocked
    setImmediate(async () => {
      try {
        const assets = await fetchBestAssets(
          "steam",
          objectId,
          ownedGame.name,
          {
            iconUrl: steamIconUrl,
            libraryHeroImageUrl:
              gameAssets?.libraryHeroImageUrl ?? steamHeroUrl,
            libraryImageUrl: gameAssets?.libraryImageUrl ?? null,
            coverImageUrl: gameAssets?.coverImageUrl ?? steamIconUrl,
            logoImageUrl: gameAssets?.logoImageUrl ?? null,
            logoPosition: gameAssets?.logoPosition ?? null,
            downloadSources: gameAssets?.downloadSources ?? [],
          }
        );
        await gamesShopAssetsSublevel.put(gameKey, {
          objectId,
          shop: "steam" as const,
          title: ownedGame.name,
          ...assets,
          updatedAt: Date.now(),
        });
      } catch {
        // Non-fatal
      }
    });

    const game = {
      title: ownedGame.name,
      iconUrl: steamIconUrl ?? gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? steamHeroUrl,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop: "steam" as const,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: ownedGame.playtime_forever * 60 * 1000,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      automaticCloudSync: true,
      libraryOrigin: "sync" as const,
      executablePath,
    };

    await gamesSublevel.put(gameKey, game);
    await createGame(game).catch(() => {});

    // Collapse any duplicate entries (e.g. custom:uuid for same title)
    await deduplicateTitle(ownedGame.name).catch(() => {});

    added++;
  }

  logger.log(`Steam library sync complete: ${added} games added`);

  void generateMissingMetadataInternal();

  return { total: ownedGames.length, added };
};

registerEvent("syncSteamLibrary", syncSteamLibrary);

export const syncSteamLibraryInternal = (steamId: string, apiKey?: string) =>
  syncSteamLibrary({} as Electron.IpcMainInvokeEvent, steamId, apiKey);
