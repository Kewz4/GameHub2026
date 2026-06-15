import { registerEvent } from "../register-event";
import {
  db,
  gamesSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import type { UserPreferences } from "@types";
import {
  refreshGogToken,
  getGogOwnedGameIds,
  getGogGameDetails,
  getGogGameCredentials,
  getGogGameToken,
  getGogGamePlaytimeMs,
  getGogUserInfo,
} from "@main/services/gog-account";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { generateMissingMetadataInternal } from "./generate-missing-metadata";
import { findGameByTitle } from "@main/helpers/find-game-by-title";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { getExcludedGames, isGameExcluded } from "@main/helpers/exclusion-list";
import { importGogAchievements } from "@main/services/achievements/platform-achievement-importer";

const syncGogLibrary = async (_event: Electron.IpcMainInvokeEvent) => {
  try {
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!prefs?.gogRefreshToken) throw new Error("GOG not connected");

    const tokens = await refreshGogToken(prefs.gogRefreshToken);

    // Persist the potentially-refreshed token
    await db.put<string, UserPreferences>(
      levelKeys.userPreferences,
      { ...prefs, gogRefreshToken: tokens.refresh_token },
      { valueEncoding: "json" }
    );

    const userInfo = await getGogUserInfo(tokens.access_token);
    const ownedIds = await getGogOwnedGameIds(tokens.access_token);

    let added = 0;
    const addedGames: Array<{
      title: string;
      coverUrl: string | null;
      what: string;
    }> = [];

    const excludedGames = await getExcludedGames();

    // Process in batches of 20 to avoid hammering the API
    for (let i = 0; i < ownedIds.length; i += 20) {
      const batch = ownedIds.slice(i, i + 20);

      await Promise.all(
        batch.map(async (productId) => {
          const objectId = String(productId);
          const gameKey = levelKeys.game("gog", objectId);

          if (isGameExcluded(excludedGames, "gog", objectId)) return;

          const existing = await gamesSublevel.get(gameKey).catch(() => null);

          // Always refresh playtime from GOG API for existing games too
          if (existing && !existing.isDeleted && userInfo) {
            // Owned on GOG — make sure it's classified as synced
            if (existing.libraryOrigin !== "sync") {
              existing.libraryOrigin = "sync";
              await gamesSublevel.put(gameKey, existing);
            }
            const credentials = await getGogGameCredentials(objectId).catch(
              () => null
            );
            const gameToken = credentials
              ? await getGogGameToken(tokens.refresh_token, credentials)
              : null;
            if (credentials && gameToken) {
              const gogPlaytimeMs = await getGogGamePlaytimeMs(
                gameToken,
                userInfo.userId,
                credentials.clientId
              );
              if (gogPlaytimeMs > (existing.playTimeInMilliseconds ?? 0)) {
                await gamesSublevel.put(gameKey, {
                  ...existing,
                  playTimeInMilliseconds: gogPlaytimeMs,
                  lastTimePlayed: existing.lastTimePlayed ?? new Date(),
                });
              }
            }
            return;
          }

          if (existing && existing.isDeleted) {
            /* fall through to re-add */
          } else if (existing) {
            return;
          }

          const details = await getGogGameDetails(productId);
          if (!details) return;

          if (details.game_type && details.game_type !== "game") return;

          if (isGameExcluded(excludedGames, "gog", objectId, details.title)) {
            return;
          }

          const titleMatch = await findGameByTitle(details.title);
          if (titleMatch) {
            const [matchKey, matchGame] = titleMatch;
            const alreadyLinked = matchGame.alternativeShops?.some(
              (s) => s.shop === "gog" && s.objectId === objectId
            );
            if (!alreadyLinked) {
              await gamesSublevel.put(matchKey, {
                ...matchGame,
                alternativeShops: [
                  ...(matchGame.alternativeShops ?? []),
                  { shop: "gog", objectId, executablePath: null },
                ],
              });
            }
            return;
          }

          const gogIconUrl = details.images?.logo2x
            ? `https:${details.images.logo2x}`
            : null;
          const gogHeroUrl = details.images?.background
            ? `https:${details.images.background}`
            : null;

          // gogIconUrl (logo2x) is a LANDSCAPE logo — never use it as the
          // portrait cover or the library card stretches it blurry. Leave the
          // cover to the catalogue/SteamGridDB (600x900 portrait grids).
          const assets = await fetchBestAssets("gog", objectId, details.title, {
            iconUrl: gogIconUrl,
            libraryHeroImageUrl: gogHeroUrl,
          });

          // Fetch playtime from GOG for new games
          let gogPlaytimeMs = 0;
          if (userInfo) {
            const credentials = await getGogGameCredentials(objectId).catch(
              () => null
            );
            const gameToken = credentials
              ? await getGogGameToken(tokens.refresh_token, credentials)
              : null;
            if (credentials && gameToken) {
              gogPlaytimeMs = await getGogGamePlaytimeMs(
                gameToken,
                userInfo.userId,
                credentials.clientId
              );
            }
          }

          const game = {
            title: details.title,
            iconUrl: assets.iconUrl,
            libraryHeroImageUrl: assets.libraryHeroImageUrl,
            logoImageUrl: assets.logoImageUrl,
            objectId,
            shop: "gog" as const,
            remoteId: null,
            isDeleted: false,
            playTimeInMilliseconds: gogPlaytimeMs,
            lastTimePlayed: gogPlaytimeMs > 0 ? new Date() : null,
            addedToLibraryAt: new Date(),
            automaticCloudSync: true,
            libraryOrigin: "sync" as const,
            executablePath: null,
          };

          await gamesSublevel.put(gameKey, game);
          await gamesShopAssetsSublevel
            .put(gameKey, {
              objectId,
              shop: "gog" as const,
              title: details.title,
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
          await deduplicateTitle(details.title).catch(() => {});
          added++;
          const gotHydraAssets = Boolean(
            assets.coverImageUrl || assets.libraryHeroImageUrl
          );
          addedGames.push({
            title: details.title,
            coverUrl:
              assets.coverImageUrl ?? assets.libraryHeroImageUrl ?? null,
            what: gotHydraAssets
              ? "Cover fetched from Hydra API (Steam catalogue)"
              : "Added — no Hydra API match found",
          });
        })
      );
    }

    logger.log(`GOG library sync complete: ${added} games added`);
    void generateMissingMetadataInternal();
    // Pull unlocked achievements from GOG in the background
    void importGogAchievements().catch(() => {});
    return { total: ownedIds.length, added, addedGames };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("GOG library sync failed", err);
    return { total: 0, added: 0, error: message };
  }
};

registerEvent("syncGogLibrary", syncGogLibrary);

export const syncGogLibraryInternal = () =>
  syncGogLibrary({} as Electron.IpcMainInvokeEvent);
