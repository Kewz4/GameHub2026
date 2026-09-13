import fs from "node:fs";
import path from "node:path";
import type { Game, SteamAchievement } from "@types";
import { achievementSouvenirsPath } from "@main/constants";
import {
  achievementSouvenirScreenshotPath,
  isOwnedAchievementSouvenirPath,
  selectAchievementSouvenirCleanupCandidates,
} from "./achievements/achievement-souvenir-policy";
import { AchievementSouvenirLocalStorage } from "./achievements/achievement-souvenir-local-storage";
import { GameRecorderManager } from "./game-recorder-manager";
import { achievementsLogger } from "./logger";
import { encodeSdrScreenshotJpeg } from "./screenshot-encoding";

const SCREENSHOT_QUALITY = 82;
const MAX_WIDTH = 1_920;
const MAX_HEIGHT = 1_080;
const MAX_STORED_SCREENSHOTS = 100;

const resizeToFit = (image: Electron.NativeImage) => {
  const { width, height } = image.getSize();
  if (width <= MAX_WIDTH && height <= MAX_HEIGHT) return image;
  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  });
};

const listScreenshots = async (
  directory: string
): Promise<Array<{ path: string; modifiedAt: number }>> => {
  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listScreenshots(entryPath);
      if (!entry.isFile() || !entry.name.endsWith(".jpeg")) return [];
      const stat = await fs.promises.stat(entryPath).catch(() => null);
      return stat ? [{ path: entryPath, modifiedAt: stat.mtimeMs }] : [];
    })
  );
  return nested.flat();
};

export class AchievementScreenshotService {
  static readonly rootPath = achievementSouvenirsPath;
  private static readonly localStorage = new AchievementSouvenirLocalStorage(
    this.rootPath
  );

  static getOwnerRoot(ownerId: string) {
    return this.localStorage.getOwnerRoot(ownerId);
  }

  static getPath(
    ownerId: string,
    game: Pick<Game, "shop" | "objectId" | "title">,
    achievement: Pick<SteamAchievement, "name" | "displayName">
  ) {
    return achievementSouvenirScreenshotPath(this.rootPath, {
      ownerId,
      shop: game.shop,
      objectId: game.objectId,
      gameTitle: game.title,
      achievementName: achievement.name,
      achievementDisplayName: achievement.displayName,
    });
  }

  static async capture(
    ownerId: string,
    game: Game,
    achievement: Pick<SteamAchievement, "name" | "displayName">
  ) {
    const frame = await GameRecorderManager.captureActiveGameFrame(game);
    const outputPath = this.getPath(ownerId, game, achievement);
    const image = resizeToFit(frame);
    const jpeg = await encodeSdrScreenshotJpeg(
      image.toPNG(),
      SCREENSHOT_QUALITY
    );
    if (!jpeg.length) throw new Error("achievement_souvenir_encode_failed");

    await this.localStorage.prepareOwnedFilePath(ownerId, outputPath);
    const temporaryPath = `${outputPath}.${process.pid}.part`;
    try {
      await fs.promises.writeFile(temporaryPath, jpeg, { flag: "w" });
      await fs.promises.rm(outputPath, { force: true });
      await fs.promises.rename(temporaryPath, outputPath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => null);
    }
    return outputPath;
  }

  static async reconcilePersistedPath(
    ownerId: string,
    filePath: string | null
  ): Promise<string | null> {
    return this.localStorage.reconcilePersistedPath(ownerId, filePath);
  }

  static async delete(ownerId: string, filePath: string | null) {
    return this.localStorage.delete(ownerId, filePath);
  }

  static async cleanup(
    ownerId: string,
    protectedPaths: readonly string[] = []
  ) {
    try {
      const screenshots = await listScreenshots(this.getOwnerRoot(ownerId));
      const ownedProtectedPaths = protectedPaths.filter((filePath) =>
        isOwnedAchievementSouvenirPath(this.rootPath, ownerId, filePath)
      );
      const outdated = selectAchievementSouvenirCleanupCandidates(
        screenshots,
        ownedProtectedPaths,
        MAX_STORED_SCREENSHOTS
      );
      await Promise.all(
        outdated.map((screenshot) =>
          fs.promises.rm(screenshot.path, { force: true })
        )
      );
    } catch (error) {
      achievementsLogger.warn("Failed to prune achievement souvenirs", error);
    }
  }
}
