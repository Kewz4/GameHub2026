import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import fs, { readdirSync } from "node:fs";
import {
  findAchievementFileInExecutableDirectory,
  findAchievementFileInSteamPath,
  findAchievementFiles,
  findAllAchievementFiles,
  getAlternativeObjectIds,
} from "./find-achivement-files";
import type {
  AchievementFile,
  Game,
  GameShop,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementsLogger } from "../logger";
import { Cracker } from "@shared";
import { publishCombinedNewAchievementNotification } from "../notifications";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "../window-manager";
import { setTimeout } from "node:timers/promises";
import { Wine } from "../wine";
import {
  refreshGogToken,
  getGogUserInfo,
  getGogGameClientId,
  getGogRemoteAchievements,
} from "../gog-account";

const fileStats: Map<string, number> = new Map();
const fltFiles: Map<string, Set<string>> = new Map();

const watchAchievementsWindows = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((games) => games.filter((game) => !game.isDeleted));

  if (games.length === 0) return;

  const achievementFiles = findAllAchievementFiles();

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );
  const enableSteamAchievements =
    userPreferences?.enableSteamAchievements ?? false;

  for (const game of games) {
    const gameAchievementFiles: AchievementFile[] = [];

    for (const objectId of getAlternativeObjectIds(game.objectId)) {
      gameAchievementFiles.push(...(achievementFiles.get(objectId) ?? []));

      gameAchievementFiles.push(
        ...findAchievementFileInExecutableDirectory(game)
      );

      if (enableSteamAchievements) {
        gameAchievementFiles.push(...findAchievementFileInSteamPath(game));
      }
    }

    for (const file of gameAchievementFiles) {
      await compareFile(game, file);
    }
  }
};

const watchAchievementsWithWine = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((games) =>
      games.filter(
        (game) =>
          !game.isDeleted &&
          !!Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
      )
    );

  if (games.length === 0) return;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );
  const enableSteamAchievements =
    userPreferences?.enableSteamAchievements ?? false;

  for (const game of games) {
    const gameAchievementFiles = findAchievementFiles(game);

    if (enableSteamAchievements) {
      gameAchievementFiles.push(...findAchievementFileInSteamPath(game));
    }

    for (const file of gameAchievementFiles) {
      await compareFile(game, file);
    }
  }
};

const compareFltFolder = async (game: Game, file: AchievementFile) => {
  try {
    const currentAchievements = new Set(readdirSync(file.filePath));
    const previousAchievements = fltFiles.get(file.filePath);

    fltFiles.set(file.filePath, currentAchievements);
    if (
      !previousAchievements ||
      currentAchievements.difference(previousAchievements).size === 0
    ) {
      return;
    }

    achievementsLogger.log("Detected change in FLT folder", file.filePath);
    await processAchievementFileDiff(game, file);
  } catch (err) {
    achievementsLogger.error(err);
    fltFiles.set(file.filePath, new Set());
  }
};

const compareFile = (game: Game, file: AchievementFile) => {
  if (file.type === Cracker.flt) {
    return compareFltFolder(game, file);
  }

  try {
    const currentStat = fs.statSync(file.filePath);
    const previousStat = fileStats.get(file.filePath);
    fileStats.set(file.filePath, currentStat.mtimeMs);

    if (!previousStat || previousStat === -1) {
      // First time seeing this file — record the baseline silently.
      // preSearchAchievements() already handles discovering achievements that
      // exist at startup without notifications; the watcher is only for changes
      // that happen while the game is actively running.
      achievementsLogger.log(
        "First sight — recording baseline without notification",
        file.filePath
      );
      return;
    }

    if (previousStat === currentStat.mtimeMs) {
      return;
    }

    achievementsLogger.log(
      "Detected change in file",
      file.filePath,
      previousStat,
      currentStat.mtimeMs
    );
    return processAchievementFileDiff(game, file);
  } catch (err) {
    achievementsLogger.error(
      "Error reading file",
      file.filePath,
      err instanceof Error ? err.message : err
    );
    fileStats.set(file.filePath, -1);
    return;
  }
};

const processAchievementFileDiff = async (
  game: Game,
  file: AchievementFile
) => {
  const parsedAchievements = parseAchievementFile(file.filePath, file.type);

  if (parsedAchievements.length) {
    return mergeAchievements(game, parsedAchievements, true);
  }

  return 0;
};

const syncGogAchievements = async (game: Game): Promise<number> => {
  try {
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (!prefs?.gogRefreshToken) return 0;

    const tokens = await refreshGogToken(prefs.gogRefreshToken);
    const userInfo = await getGogUserInfo(tokens.access_token);
    if (!userInfo) return 0;

    const clientId = await getGogGameClientId(game.objectId);
    if (!clientId) return 0;

    const remoteAchievements = await getGogRemoteAchievements(
      tokens.access_token,
      userInfo.userId,
      clientId
    );

    const unlockedAchievements: UnlockedAchievement[] = remoteAchievements
      .filter((a) => !!a.date_unlocked)
      .map((a) => ({
        name: a.achievement_key,
        unlockTime: Math.floor(new Date(a.date_unlocked!).getTime() / 1000),
      }));

    if (unlockedAchievements.length === 0) return 0;
    return mergeAchievements(game, unlockedAchievements, false);
  } catch (err) {
    achievementsLogger.error("GOG achievement sync failed", game.objectId, err);
    return 0;
  }
};

export class AchievementWatcherManager {
  private static _hasFinishedPreSearch = false;

  public static get hasFinishedPreSearch() {
    return this._hasFinishedPreSearch;
  }

  public static readonly alreadySyncedGames: Map<string, boolean> = new Map();

  public static async firstSyncWithRemoteIfNeeded(
    shop: GameShop,
    objectId: string
  ) {
    if (shop === "custom") return;

    const gameKey = levelKeys.game(shop, objectId);
    if (this.alreadySyncedGames.get(gameKey)) return;

    this.alreadySyncedGames.set(gameKey, true);

    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game || game.isDeleted) return;

    const gameAchievementFiles = findAchievementFiles(game);

    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    if (userPreferences?.enableSteamAchievements) {
      gameAchievementFiles.push(...findAchievementFileInSteamPath(game));
    }

    const unlockedAchievements: UnlockedAchievement[] = [];

    for (const achievementFile of gameAchievementFiles) {
      const localAchievementFile = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      if (localAchievementFile.length) {
        unlockedAchievements.push(...localAchievementFile);
      }
    }

    let newAchievements = await mergeAchievements(
      game,
      unlockedAchievements,
      false
    );

    if (game.shop === "gog") {
      newAchievements += await syncGogAchievements(game);
    }

    if (newAchievements > 0) {
      this.notifyCombinedAchievementsUnlocked(1, newAchievements);
    }
  }

  public static watchAchievements() {
    if (!this.hasFinishedPreSearch) return;

    if (process.platform === "win32") {
      return watchAchievementsWindows();
    }

    return watchAchievementsWithWine();
  }

  private static preProcessGameAchievementFiles(
    game: Game,
    gameAchievementFiles: AchievementFile[]
  ) {
    const unlockedAchievements: UnlockedAchievement[] = [];
    for (const achievementFile of gameAchievementFiles) {
      const parsedAchievements = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      try {
        const currentStat = fs.statSync(achievementFile.filePath);
        fileStats.set(achievementFile.filePath, currentStat.mtimeMs);
      } catch {
        fileStats.set(achievementFile.filePath, -1);
      }

      if (parsedAchievements.length) {
        unlockedAchievements.push(...parsedAchievements);

        achievementsLogger.log(
          "Achievement file for",
          game.title,
          achievementFile.filePath,
          parsedAchievements
        );
      }
    }

    if (unlockedAchievements.length) {
      return mergeAchievements(game, unlockedAchievements, false);
    }

    return 0;
  }

  private static async getGameAchievementFilesWindows() {
    const games = await gamesSublevel
      .values()
      .all()
      .then((games) => games.filter((game) => !game.isDeleted));

    const gameAchievementFilesMap = findAllAchievementFiles();

    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );
    const enableSteamAchievements =
      userPreferences?.enableSteamAchievements ?? false;

    return Promise.all(
      games.map(async (game) => {
        const achievementFiles: AchievementFile[] = [];

        for (const objectId of getAlternativeObjectIds(game.objectId)) {
          achievementFiles.push(
            ...(gameAchievementFilesMap.get(objectId) || [])
          );

          achievementFiles.push(
            ...findAchievementFileInExecutableDirectory(game)
          );

          if (enableSteamAchievements) {
            achievementFiles.push(...findAchievementFileInSteamPath(game));
          }
        }

        return { game, achievementFiles };
      })
    );
  }

  private static async getGameAchievementFilesLinux() {
    const games = await gamesSublevel
      .values()
      .all()
      .then((games) => games.filter((game) => !game.isDeleted));

    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );
    const enableSteamAchievements =
      userPreferences?.enableSteamAchievements ?? false;

    return Promise.all(
      games.map(async (game) => {
        const achievementFiles = findAchievementFiles(game);

        if (enableSteamAchievements) {
          achievementFiles.push(...findAchievementFileInSteamPath(game));
        }

        return { game, achievementFiles };
      })
    );
  }

  private static async notifyCombinedAchievementsUnlocked(
    totalNewGamesWithAchievements: number,
    totalNewAchievements: number
  ) {
    const userPreferences = await db.get<string, UserPreferences>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    const shouldUseCustomNotification =
      userPreferences.achievementCustomNotificationsEnabled !== false &&
      process.platform !== "darwin" &&
      !!WindowManager.notificationWindow;

    if (shouldUseCustomNotification) {
      WindowManager.notificationWindow?.webContents.send(
        "on-combined-achievements-unlocked",
        totalNewGamesWithAchievements,
        totalNewAchievements,
        userPreferences.achievementCustomNotificationPosition ?? "top-left"
      );
    } else {
      publishCombinedNewAchievementNotification(
        totalNewAchievements,
        totalNewGamesWithAchievements
      );
    }
  }

  public static async preSearchAchievements() {
    try {
      const gameAchievementFiles =
        process.platform === "win32"
          ? await this.getGameAchievementFilesWindows()
          : await this.getGameAchievementFilesLinux();

      const newAchievementsCount = await Promise.all(
        gameAchievementFiles.map(({ game, achievementFiles }) => {
          return this.preProcessGameAchievementFiles(game, achievementFiles);
        })
      );

      const totalNewGamesWithAchievements = newAchievementsCount.filter(
        (achievements) => achievements
      ).length;

      const totalNewAchievements = newAchievementsCount.reduce(
        (acc, val) => acc + val,
        0
      );

      if (totalNewAchievements > 0) {
        await setTimeout(4000);
        this.notifyCombinedAchievementsUnlocked(
          totalNewGamesWithAchievements,
          totalNewAchievements
        );
      }

      // Sync GOG achievements from API for all GOG games
      const gogGames = (await gamesSublevel.values().all()).filter(
        (g) => !g.isDeleted && g.shop === "gog"
      );

      for (const gogGame of gogGames) {
        await syncGogAchievements(gogGame).catch(() => {});
      }
    } catch (err) {
      achievementsLogger.error("Error on preSearchAchievements", err);
    }

    this._hasFinishedPreSearch = true;
  }
}
