import path from "node:path";
import fs from "node:fs";

import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gameAchievementsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  getGameHubMeta,
} from "@main/level";
import { systemFromObjectId, platformToSystem } from "@main/helpers";

const getLibrary = async (): Promise<LibraryGame[]> => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) => game.isDeleted === false)
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key);
            const gameAssets = await gamesShopAssetsSublevel.get(key);

            // Console/emulated (launchbox) games rarely have stored shop assets
            // — their art lives in the local gamehub-meta dataset (same source
            // the game-details page uses). Resolve it here so the library grid
            // and downloads hero show real cover/hero art instead of a broken
            // placeholder.
            let meta: Awaited<ReturnType<typeof getGameHubMeta>> = null;
            if (
              game.shop === "launchbox" &&
              (!gameAssets?.coverImageUrl ||
                !gameAssets?.libraryImageUrl ||
                !gameAssets?.libraryHeroImageUrl)
            ) {
              const system =
                systemFromObjectId(game.objectId) ??
                platformToSystem(game.platform);
              if (system) {
                meta = await getGameHubMeta(system, game.title).catch(
                  () => null
                );
              }
            }
            const achievements = await gameAchievementsSublevel
              .get(key)
              .catch(() => null);

            const validAchievementNames = new Set(
              achievements?.achievements?.map((a) =>
                (a.name ?? "").toUpperCase()
              ) || []
            );

            // Map of achievement apiName -> points, used to compute the locally
            // earned points sum from the unlocked list.
            const achievementPoints = new Map(
              achievements?.achievements?.map((a) => [
                (a.name ?? "").toUpperCase(),
                a.points ?? 0,
              ]) || []
            );

            // Count unlocked achievements by unique, valid apiName. We do NOT
            // require unlockTime > 0 here: achievements imported from Exophase
            // and PlayStation often have no unlock timestamp, and excluding
            // them undercounts the real total (the cause of the profile sum
            // showing far fewer than are actually stored).
            const validUnlockedNames =
              achievements?.unlockedAchievements != null
                ? new Set(
                    achievements.unlockedAchievements
                      .map((unlocked) => (unlocked.name ?? "").toUpperCase())
                      .filter((name) => validAchievementNames.has(name))
                  )
                : null;

            const unlockedAchievementCount =
              validUnlockedNames?.size ?? game.unlockedAchievementCount ?? 0;

            const achievementsPointsEarnedSum = validUnlockedNames
              ? Array.from(validUnlockedNames).reduce(
                  (acc, name) => acc + (achievementPoints.get(name) ?? 0),
                  0
                )
              : 0;

            // Verify installer still exists, clear if deleted externally
            let installerSizeInBytes = game.installerSizeInBytes;
            if (installerSizeInBytes && download?.folderName) {
              const installerPath = path.join(
                download.downloadPath,
                download.folderName
              );

              if (!fs.existsSync(installerPath)) {
                installerSizeInBytes = null;
                gamesSublevel.put(key, { ...game, installerSizeInBytes: null });
              }
            }

            // Verify installed folder still exists, clear if deleted externally
            let installedSizeInBytes = game.installedSizeInBytes;
            if (installedSizeInBytes && game.executablePath) {
              const executableDir = path.dirname(game.executablePath);

              if (!fs.existsSync(executableDir)) {
                installedSizeInBytes = null;
                gamesSublevel.put(key, {
                  ...game,
                  installerSizeInBytes,
                  installedSizeInBytes: null,
                });
              }
            }

            return {
              // Spread gameAssets first (image URLs, downloadSources, etc.)
              ...gameAssets,
              // Game record always wins for identity/navigation fields
              ...game,
              // Ensure id is always the LevelDB key, never overridden
              id: key,
              objectId: game.objectId,
              shop: game.shop,
              title: game.title,
              installerSizeInBytes,
              installedSizeInBytes,
              download: download ?? null,
              unlockedAchievementCount,
              achievementsPointsEarnedSum,
              // Total possible: best of the library record and the stored
              // definitions, so the "X/Y" display never loses its denominator
              // (some imports leave game.achievementCount at 0 while definitions
              // exist — that's the cause of a bare "22" instead of "22/37").
              achievementCount: Math.max(
                game.achievementCount ?? 0,
                achievements?.achievements?.length ?? 0,
                unlockedAchievementCount
              ),
              // Image URLs: prefer custom overrides, then fresh assets, then game record
              iconUrl:
                game.customIconUrl ||
                gameAssets?.iconUrl ||
                game.iconUrl ||
                meta?.iconUrl ||
                null,
              libraryHeroImageUrl:
                game.customHeroImageUrl ||
                gameAssets?.libraryHeroImageUrl ||
                game.libraryHeroImageUrl ||
                meta?.libraryHeroImageUrl ||
                meta?.coverImageUrl ||
                null,
              logoImageUrl:
                game.customLogoImageUrl ||
                gameAssets?.logoImageUrl ||
                game.logoImageUrl ||
                meta?.logoImageUrl ||
                null,
              libraryImageUrl:
                game.customLibraryImageUrl ||
                gameAssets?.libraryImageUrl ||
                meta?.libraryImageUrl ||
                meta?.coverImageUrl ||
                null,
              coverImageUrl:
                game.customLibraryImageUrl ||
                gameAssets?.coverImageUrl ||
                meta?.coverImageUrl ||
                null,
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
              customLibraryImageUrl: game.customLibraryImageUrl,
            };
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
