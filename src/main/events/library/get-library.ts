import path from "node:path";
import fs from "node:fs";

import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gameAchievementsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
} from "@main/level";

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

            const validUnlockedAchievements =
              achievements?.unlockedAchievements?.filter(
                (unlocked) =>
                  validAchievementNames.has(
                    (unlocked.name ?? "").toUpperCase()
                  ) && unlocked.unlockTime > 0
              ) ?? null;

            const unlockedAchievementCount =
              validUnlockedAchievements?.length ??
              game.unlockedAchievementCount ??
              0;

            const achievementsPointsEarnedSum =
              validUnlockedAchievements?.reduce(
                (acc, unlocked) =>
                  acc +
                  (achievementPoints.get((unlocked.name ?? "").toUpperCase()) ??
                    0),
                0
              ) ?? 0;

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
              achievementCount: game.achievementCount ?? 0,
              // Image URLs: prefer custom overrides, then fresh assets, then game record
              iconUrl:
                game.customIconUrl ||
                gameAssets?.iconUrl ||
                game.iconUrl ||
                null,
              libraryHeroImageUrl:
                game.customHeroImageUrl ||
                gameAssets?.libraryHeroImageUrl ||
                game.libraryHeroImageUrl ||
                null,
              logoImageUrl:
                game.customLogoImageUrl ||
                gameAssets?.logoImageUrl ||
                game.logoImageUrl ||
                null,
              libraryImageUrl: gameAssets?.libraryImageUrl || null,
              coverImageUrl: gameAssets?.coverImageUrl || null,
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
            };
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
