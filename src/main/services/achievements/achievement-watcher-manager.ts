import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import fs, { readdirSync } from "node:fs";
import {
  findAchievementFileInExecutableDirectory,
  findAchievementFileInSteamPath,
  findAchievementFiles,
  findAllAchievementFiles,
  getAlternativeObjectIds,
  heuristicScanAchievementFiles,
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
import { db, gameAchievementsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { getGameAchievementData } from "./get-game-achievement-data";
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

    if (game.experimentalAchievementsEnabled) {
      gameAchievementFiles.push(...heuristicScanAchievementFiles(game));
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

    if (game.experimentalAchievementsEnabled) {
      gameAchievementFiles.push(...heuristicScanAchievementFiles(game));
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

interface HydraCloudAchievement {
  name: string;
  unlockTime: number;
  unlockedOn: { hydra: boolean; steam: boolean; playstation: boolean; xbox: boolean };
}

/**
 * Pull achievements already stored on the Hydra cloud for this game and seed
 * the local cache with any that are marked as unlocked via Hydra.  This is the
 * only path that brings remote unlocks (e.g. from an Exophase/PSN import done
 * on another session, or from another device) into the desktop client's local
 * LevelDB.
 *
 * IMPORTANT: this must work for platform-synced games (Steam/GOG/Epic) which do
 * NOT have a `remoteId` — the read endpoint keys off the user id + shop +
 * objectId, not the cloud-library record id. Only the write/PUT path needs a
 * remoteId, so we must NOT gate the pull on it.
 *
 * We only run this when the local cache currently has zero unlocks so we never
 * overwrite a richer local record. Returns the number of unlocks seeded.
 */
const pullHydraCloudAchievementsIfEmpty = async (
  game: Game
): Promise<number> => {
  if (game.shop === "custom" || !HydraApi.isLoggedIn()) return 0;

  const gameKey = levelKeys.game(game.shop, game.objectId);
  const cached = await gameAchievementsSublevel.get(gameKey).catch(() => null);

  // Exophase owns its games (its apiNames differ from the cloud's), so never
  // overwrite. And never clobber a local record that already has unlocks.
  if (cached?.source === "exophase") return 0;
  if (cached?.unlockedAchievements && cached.unlockedAchievements.length > 0) {
    return 0;
  }

  const user = await db
    .get<string, { id: string }>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (!user?.id) return 0;

  const remoteAchievements = await HydraApi.get<HydraCloudAchievement[]>(
    `/users/${user.id}/games/achievements`,
    { shop: game.shop, objectId: game.objectId }
  ).catch(() => null);

  if (!remoteAchievements?.length) return 0;

  const hydraUnlocked: UnlockedAchievement[] = remoteAchievements
    .filter((a) => a.unlockedOn?.hydra)
    .map((a) => ({ name: a.name, unlockTime: a.unlockTime }));

  if (!hydraUnlocked.length) return 0;

  // Ensure the achievement DEFINITIONS (schema) are present locally. The
  // library count + game detail page only credit an unlock whose apiName exists
  // in the definition set, so seeding unlocks without definitions would still
  // show 0. getGameAchievementData fetches + persists the schema when missing.
  let definitions = cached?.achievements ?? [];
  if (!definitions.length) {
    definitions = await getGameAchievementData(
      game.objectId,
      game.shop,
      true
    ).catch(() => [] as typeof definitions);
  }

  // Re-read in case getGameAchievementData wrote a fresh record.
  const latest = await gameAchievementsSublevel.get(gameKey).catch(() => null);

  achievementsLogger.log(
    "Seeding local cache from Hydra cloud",
    game.shop,
    game.objectId,
    `(${hydraUnlocked.length} unlocked)`
  );

  await gameAchievementsSublevel.put(gameKey, {
    ...latest,
    achievements: latest?.achievements?.length
      ? latest.achievements
      : definitions,
    unlockedAchievements: hydraUnlocked,
    updatedAt: latest?.updatedAt ?? Date.now(),
    language: latest?.language,
  });

  // Keep the games record's denormalised count in sync so the library grid and
  // profile overlay reflect the unlock immediately.
  const gameRecord = await gamesSublevel.get(gameKey).catch(() => null);
  if (gameRecord) {
    await gamesSublevel.put(gameKey, {
      ...gameRecord,
      unlockedAchievementCount: hydraUnlocked.length,
    });
  }

  return hydraUnlocked.length;
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

    if (game.experimentalAchievementsEnabled) {
      gameAchievementFiles.push(...heuristicScanAchievementFiles(game));
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

    await pullHydraCloudAchievementsIfEmpty(game);

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

      // Pull any cloud-stored unlocks (Exophase/PSN imports, other devices) into
      // the local cache for the whole library. This is the only path that brings
      // remote unlocks down to platform-synced games (Steam/GOG/Epic) which have
      // no remoteId, so it must run for every game — not just on game-open.
      await this.pullCloudAchievementsForLibrary();
    } catch (err) {
      achievementsLogger.error("Error on preSearchAchievements", err);
    }

    this._hasFinishedPreSearch = true;
  }

  public static async pullCloudAchievementsForLibrary() {
    if (!HydraApi.isLoggedIn()) return;

    const games = (await gamesSublevel.values().all()).filter(
      (g) => !g.isDeleted && g.shop !== "custom"
    );

    let seeded = 0;
    for (const game of games) {
      seeded += await pullHydraCloudAchievementsIfEmpty(game).catch(() => 0);
    }

    if (seeded > 0) {
      achievementsLogger.log(
        `Seeded ${seeded} cloud unlock(s) into local cache; refreshing library`
      );
      WindowManager.sendToAppWindows("on-library-batch-complete");
    }
  }
}
