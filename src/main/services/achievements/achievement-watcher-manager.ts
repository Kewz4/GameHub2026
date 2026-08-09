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
} from "./find-achievement-files";
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
import {
  db,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { HydraApi } from "../hydra-api";
import { getGameAchievementData } from "./get-game-achievement-data";
import { storeAchievementProgress } from "./store-achievement-progress";
import { WindowManager } from "../window-manager";
import { setTimeout } from "node:timers/promises";
import { Wine } from "../wine";
import {
  refreshGogToken,
  getGogUserInfo,
  getGogGameClientId,
  getGogRemoteAchievements,
} from "../gog-account";
import { getAchievementSyncAccountId } from "./achievement-cloud-sync";
import { canonicalizeUnlockedAchievements } from "./achievement-sync-policy";
import { repairAchievementRecords } from "./repair-achievement-records";

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
  // Update fractional progress (e.g. "38/100 kills") for stat-gated, still-
  // locked achievements every time the file changes while the game runs.
  await storeAchievementProgress(game, [file]).catch(() => {});

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
  displayName?: string;
  description?: string;
  icon?: string;
  hidden?: boolean;
  unlockTime: number;
  unlockedOn: {
    hydra: boolean;
    steam: boolean;
    playstation: boolean;
    xbox: boolean;
  };
}

interface CloudProfileGame {
  id: string;
  shop: GameShop;
  objectId: string;
  title: string;
  achievementCount?: number;
  unlockedAchievementCount?: number;
}

/** Normalise a title for cross-shop matching (lowercase, alphanumerics only). */
const normalizeTitleForMatch = (s: string): string =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Seed a single LOCAL library game's achievement cache from the Hydra cloud.
 *
 * The cloud stores cross-platform games (Epic / GOG / Exophase-imported) under
 * their CANONICAL Steam objectId, not the shop the user actually owns them on.
 * So we cannot just query `/users/{id}/games/achievements?shop={localShop}` —
 * for an Epic-owned Fall Guys that returns nothing. Instead we match the local
 * game to the user's cloud library (`/profile/games`) by exact shop+objectId
 * first, then by normalised title, and pull the unlocks under the CANONICAL
 * shop/objectId while writing them onto the LOCAL game's key.
 *
 * Only seeds when the local record currently has zero unlocks, so a richer
 * local state (or Exophase-owned data) is never clobbered. Returns the number
 * of unlocks seeded.
 */
const seedAchievementsFromCloud = async (
  game: Game,
  cloudGames: CloudProfileGame[],
  userId: string
): Promise<number> => {
  if (game.shop === "custom") return 0;

  const gameKey = levelKeys.game(game.shop, game.objectId);
  const cached = await gameAchievementsSublevel.get(gameKey).catch(() => null);

  // Exophase owns its games (its apiNames differ from the cloud's), so never
  // overwrite. And never clobber a local record that already has unlocks.
  if (cached?.source === "exophase") return 0;
  if (cached?.unlockedAchievements && cached.unlockedAchievements.length > 0) {
    return 0;
  }

  // Resolve the canonical cloud record for this game. Exact shop+objectId wins;
  // otherwise fall back to a normalised-title match (handles Epic/GOG locals
  // whose unlocks live under the canonical Steam objectId in the cloud).
  const localNorm = normalizeTitleForMatch(game.title);
  const match =
    cloudGames.find(
      (c) => c.shop === game.shop && c.objectId === game.objectId
    ) ?? cloudGames.find((c) => normalizeTitleForMatch(c.title) === localNorm);

  if (!match || (match.unlockedAchievementCount ?? 0) <= 0) return 0;

  const remoteAchievements = await HydraApi.get<HydraCloudAchievement[]>(
    `/users/${userId}/games/achievements`,
    { shop: match.shop, objectId: match.objectId, language: "en" }
  ).catch(() => null);

  if (!remoteAchievements?.length) return 0;

  const hydraUnlocked: UnlockedAchievement[] = remoteAchievements
    .filter((a) => a.unlockedOn?.hydra)
    .map((a) => ({ name: a.name, unlockTime: a.unlockTime }));

  if (!hydraUnlocked.length) return 0;

  // Definitions (schema): the per-user endpoint only returns the user's
  // unlocked rows, so we'd show e.g. 11/11 instead of 11/34. Fetch the FULL
  // schema from the canonical shop/objectId; fall back to the per-user rows
  // (then nothing) so we always have something to credit the unlocks against.
  let definitions = cached?.achievements ?? [];
  if (!definitions.length) {
    definitions = await getGameAchievementData(
      match.objectId,
      match.shop,
      true
    ).catch(() => [] as typeof definitions);
  }
  if (!definitions.length) {
    definitions = remoteAchievements.map((a) => ({
      name: a.name,
      displayName: a.displayName ?? a.name,
      description: a.description ?? "",
      icon: a.icon ?? "",
      icongray: a.icon ?? "",
      hidden: a.hidden ?? false,
    }));
  }

  achievementsLogger.log(
    "Seeded cloud achievements",
    `${game.shop}:${game.objectId}`,
    `via ${match.shop}:${match.objectId}`,
    `(${hydraUnlocked.length}/${definitions.length})`
  );

  const canonicalUnlocked = canonicalizeUnlockedAchievements(
    definitions,
    hydraUnlocked
  );
  if (!canonicalUnlocked.length) return 0;

  await gameAchievementsSublevel.put(gameKey, {
    ...cached,
    achievements: cached?.achievements?.length
      ? cached.achievements
      : definitions,
    unlockedAchievements: canonicalUnlocked,
    updatedAt: cached?.updatedAt ?? Date.now(),
    language: cached?.language ?? "en",
  });

  // Keep the games record's denormalised counts in sync so the library grid and
  // profile overlay reflect the unlock immediately.
  const gameRecord = await gamesSublevel.get(gameKey).catch(() => null);
  if (gameRecord) {
    await gamesSublevel.put(gameKey, {
      ...gameRecord,
      unlockedAchievementCount: canonicalUnlocked.length,
      achievementCount: definitions.length || gameRecord.achievementCount,
    });
  }

  return canonicalUnlocked.length;
};

/** Fetch the user's cloud library + id, for seeding one or many games. */
const getCloudSeedContext = async (): Promise<{
  userId: string;
  cloudGames: CloudProfileGame[];
} | null> => {
  if (!HydraApi.isLoggedIn()) return null;
  const user = await db
    .get<string, { id: string }>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (!user?.id) return null;
  const cloudGames = await HydraApi.get<CloudProfileGame[]>(
    "/profile/games"
  ).catch(() => null);
  if (!cloudGames?.length) return null;
  return { userId: user.id, cloudGames };
};

export class AchievementWatcherManager {
  private static _hasFinishedPreSearch = false;

  public static get hasFinishedPreSearch() {
    return this._hasFinishedPreSearch;
  }

  public static readonly alreadySyncedGames: Map<string, boolean> = new Map();
  private static readonly firstSyncInFlight = new Map<string, Promise<void>>();

  private static async scopedSyncKey(
    gameKey: string,
    remoteId: string | null | undefined
  ) {
    const accountId = (await getAchievementSyncAccountId()) ?? "logged-out";
    return `${accountId}:${gameKey}:${remoteId ?? "local"}`;
  }

  public static async markGameSynced(
    gameKey: string,
    remoteId: string | null | undefined
  ) {
    this.alreadySyncedGames.set(
      await this.scopedSyncKey(gameKey, remoteId),
      true
    );
  }

  public static resetSyncSession() {
    this.alreadySyncedGames.clear();
    this.firstSyncInFlight.clear();
    this._hasFinishedPreSearch = false;
  }

  public static async firstSyncWithRemoteIfNeeded(
    shop: GameShop,
    objectId: string
  ) {
    if (shop === "custom") return;

    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game || game.isDeleted) return;

    const scopedKey = await this.scopedSyncKey(gameKey, game.remoteId);
    if (this.alreadySyncedGames.get(scopedKey)) return;

    const pending = this.firstSyncInFlight.get(scopedKey);
    if (pending) return pending;

    const task = (async () => {
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

      // Seed fractional progress so locked stat-gated achievements show a bar the
      // first time the game's achievements page is opened (mergeAchievements has
      // already populated the definitions record this writes onto).
      await storeAchievementProgress(game, gameAchievementFiles).catch(
        () => {}
      );

      if (game.shop === "gog") {
        newAchievements += await syncGogAchievements(game);
      }

      const seedCtx = await getCloudSeedContext();
      if (seedCtx) {
        await seedAchievementsFromCloud(
          game,
          seedCtx.cloudGames,
          seedCtx.userId
        ).catch(() => 0);
      }

      if (newAchievements > 0) {
        this.notifyCombinedAchievementsUnlocked(1, newAchievements);
      }
    })();

    this.firstSyncInFlight.set(scopedKey, task);
    return task.finally(() => {
      if (this.firstSyncInFlight.get(scopedKey) === task) {
        this.firstSyncInFlight.delete(scopedKey);
      }
    });
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

    const customEnabled =
      userPreferences.achievementCustomNotificationsEnabled !== false &&
      process.platform !== "darwin";

    const shownInOverlay =
      customEnabled &&
      (await WindowManager.showCombinedAchievementsNotification(
        totalNewGamesWithAchievements,
        totalNewAchievements,
        userPreferences.achievementCustomNotificationPosition ?? "top-left"
      ));

    if (!shownInOverlay) {
      publishCombinedNewAchievementNotification(
        totalNewAchievements,
        totalNewGamesWithAchievements
      );
    }
  }

  public static async preSearchAchievements() {
    try {
      await repairAchievementRecords();
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
    const seedCtx = await getCloudSeedContext();
    if (!seedCtx) return;

    const games = (await gamesSublevel.values().all()).filter(
      (g) => !g.isDeleted && g.shop !== "custom"
    );

    let seeded = 0;
    let gamesSeeded = 0;
    for (const game of games) {
      const n = await seedAchievementsFromCloud(
        game,
        seedCtx.cloudGames,
        seedCtx.userId
      ).catch(() => 0);
      if (n > 0) {
        seeded += n;
        gamesSeeded++;
      }
    }

    if (seeded > 0) {
      achievementsLogger.log(
        `Seeded ${seeded} cloud unlock(s) across ${gamesSeeded} game(s); refreshing library`
      );
      WindowManager.sendToAppWindows("on-library-batch-complete");

      // Restore the post-login "Unlocked X new achievements from Y games"
      // notification: it fires only on the first login that actually restores
      // cloud unlocks (seedAchievementsFromCloud early-returns once a game has
      // local unlocks), so it won't repeat on every launch.
      await this.notifyCombinedAchievementsUnlocked(gamesSeeded, seeded);
    }
  }
}
