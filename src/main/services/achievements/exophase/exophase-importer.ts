import {
  db,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  Game,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementsLogger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { DEFAULT_MANAGED_SHOPS, SHOP_TO_EXOPHASE_SLUG } from "./constants";
import { ExophaseFetcher } from "./exophase-web";
import {
  awardsUrlFor,
  findBestMatch,
  normalizeAchievementName,
  parseAchievements,
  searchExophaseGames,
  type ExophaseAchievement,
} from "./exophase-api";

export interface ExophaseSyncResult {
  gamesProcessed: number;
  gamesWithAchievements: number;
  totalUnlocked: number;
  error?: string;
}

export interface ExophasePsnImportResult {
  gamesProcessed: number;
  gamesMatched: number;
  totalUnlocked: number;
  error?: string;
}

export interface ExophaseSyncProgress {
  current: number;
  total: number;
  title: string;
}

const getPrefs = (): Promise<UserPreferences | null> =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const toDefinitions = (
  achievements: ExophaseAchievement[]
): SteamAchievement[] =>
  achievements.map((a) => ({
    name: a.apiName,
    displayName: a.displayName,
    description: a.description,
    icon: a.iconUrl,
    icongray: a.iconUrl,
    hidden: false,
    points: a.points ?? undefined,
  }));

const toUnlockedList = (
  achievements: ExophaseAchievement[]
): UnlockedAchievement[] =>
  achievements
    .filter((a) => a.unlocked)
    .map((a) => ({ name: a.apiName, unlockTime: a.unlockTime ?? Date.now() }));

/** Merges unlocked lists, keeping the earliest unlock time per achievement. */
const mergeUnlocked = (
  ...lists: UnlockedAchievement[][]
): UnlockedAchievement[] => {
  const byName = new Map<string, UnlockedAchievement>();
  for (const list of lists) {
    for (const a of list) {
      const key = a.name.toUpperCase();
      const existing = byName.get(key);
      if (!existing || a.unlockTime < existing.unlockTime) byName.set(key, a);
    }
  }
  return [...byName.values()];
};

const persistGameAchievements = async (
  gameKey: string,
  game: Game,
  definitions: SteamAchievement[],
  unlocked: UnlockedAchievement[]
): Promise<void> => {
  await gameAchievementsSublevel.put(gameKey, {
    achievements: definitions,
    unlockedAchievements: unlocked,
    updatedAt: Date.now(),
    language: "en",
    source: "exophase",
  });

  await gamesSublevel.put(gameKey, {
    ...game,
    achievementCount: definitions.length,
    unlockedAchievementCount: unlocked.length,
  });

  WindowManager.mainWindow?.webContents.send(
    `on-update-achievements-${game.objectId}-${game.shop}`,
    unlocked
  );
};

/** Writes parsed Exophase achievements into the shared achievement store so the
 *  existing game-details UI renders them with no further changes. */
async function storeExophaseAchievements(
  gameKey: string,
  game: Game,
  achievements: ExophaseAchievement[]
): Promise<void> {
  await persistGameAchievements(
    gameKey,
    game,
    toDefinitions(achievements),
    toUnlockedList(achievements)
  );
}

const isManaged = (shop: GameShop, prefs: UserPreferences | null): boolean => {
  const managed = prefs?.exophaseManagedPlatforms ?? DEFAULT_MANAGED_SHOPS;
  return managed.includes(shop);
};

/** Library games on a managed, Exophase-mappable shop (i.e. the PC games we can
 *  fetch achievements for). PSN is never a library shop here. */
const collectEligibleGames = async (
  prefs: UserPreferences | null
): Promise<Array<[string, Game]>> => {
  const eligible: Array<[string, Game]> = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game || game.isDeleted) continue;
    if (!SHOP_TO_EXOPHASE_SLUG[game.shop]) continue;
    if (!isManaged(game.shop, prefs)) continue;
    eligible.push([key, game]);
  }
  return eligible;
};

/**
 * Pulls achievements for every eligible library game from Exophase and stores
 * them. Eligible = the game's shop maps to an Exophase platform AND that shop
 * is in the user's "Managed Platforms" set.
 *
 * Requires a logged-in Exophase session (cookies live in `persist:exophase`),
 * which is what lets the awards pages render the user's own earned state.
 */
export async function syncExophaseAchievements(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophaseSyncResult> {
  const result: ExophaseSyncResult = {
    gamesProcessed: 0,
    gamesWithAchievements: 0,
    totalUnlocked: 0,
  };

  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) {
    return { ...result, error: "Exophase account not connected." };
  }
  if (prefs.exophaseEnabled === false) {
    return { ...result, error: "Exophase is disabled." };
  }

  // Collect eligible games up front so we can report accurate progress totals.
  const eligible = await collectEligibleGames(prefs);

  const fetcher = new ExophaseFetcher();
  try {
    for (const [key, game] of eligible) {
      result.gamesProcessed++;
      onProgress?.({
        current: result.gamesProcessed,
        total: eligible.length,
        title: game.title,
      });

      const slug = SHOP_TO_EXOPHASE_SLUG[game.shop]!;
      try {
        const candidates = await searchExophaseGames(fetcher, game.title, slug);
        const match = findBestMatch(game.title, candidates, slug);
        if (!match) continue;

        const url = awardsUrlFor(match);
        if (!url) continue;

        const html = await fetcher.fetchHtml(url);
        const achievements = parseAchievements(html);
        if (achievements.length === 0) continue;

        await storeExophaseAchievements(key, game, achievements);
        result.gamesWithAchievements++;
        result.totalUnlocked += achievements.filter((a) => a.unlocked).length;
      } catch (err) {
        achievementsLogger.warn(
          `[Exophase] failed importing achievements for "${game.title}"`,
          err
        );
      }
    }
  } finally {
    fetcher.close();
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  achievementsLogger.log(
    `[Exophase] sync complete: ${result.gamesWithAchievements}/${result.gamesProcessed} games, ${result.totalUnlocked} unlocked`
  );
  return result;
}

/**
 * Cross-platform PlayStation import. For every eligible PC library game it:
 *   1. finds that game's PSN entry on Exophase and reads the trophies you've
 *      earned (your linked PSN account drives the earned state);
 *   2. finds the same game's PC entry to get the PC achievement definitions;
 *   3. credits each PC achievement whose name matches an earned PSN trophy as
 *      unlocked (e.g. God of War PS4 trophies → unlocked on God of War PC).
 *
 * PC-earned achievements (if any) are preserved and merged in too.
 */
export async function importPlaystationAchievements(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophasePsnImportResult> {
  const result: ExophasePsnImportResult = {
    gamesProcessed: 0,
    gamesMatched: 0,
    totalUnlocked: 0,
  };

  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) {
    return { ...result, error: "Exophase account not connected." };
  }
  if (prefs.exophaseEnabled === false) {
    return { ...result, error: "Exophase is disabled." };
  }

  const eligible = await collectEligibleGames(prefs);

  const fetcher = new ExophaseFetcher();
  try {
    for (const [key, game] of eligible) {
      result.gamesProcessed++;
      onProgress?.({
        current: result.gamesProcessed,
        total: eligible.length,
        title: game.title,
      });

      try {
        // 1. Your earned PSN trophies for this title.
        const psnCandidates = await searchExophaseGames(
          fetcher,
          game.title,
          "psn"
        );
        const psnMatch = findBestMatch(game.title, psnCandidates, "psn");
        if (!psnMatch) continue;
        const psnTrophies = parseAchievements(
          await fetcher.fetchHtml(awardsUrlFor(psnMatch))
        );
        const earnedNames = new Set(
          psnTrophies
            .filter((t) => t.unlocked)
            .map((t) => normalizeAchievementName(t.displayName))
        );
        if (earnedNames.size === 0) continue;

        // 2. The PC achievement definitions for the same title.
        const slug = SHOP_TO_EXOPHASE_SLUG[game.shop]!;
        const pcCandidates = await searchExophaseGames(
          fetcher,
          game.title,
          slug
        );
        const pcMatch = findBestMatch(game.title, pcCandidates, slug);
        if (!pcMatch) continue;
        const pcAchievements = parseAchievements(
          await fetcher.fetchHtml(awardsUrlFor(pcMatch))
        );
        if (pcAchievements.length === 0) continue;

        // 3. Credit PC achievements whose name matches an earned PSN trophy.
        const psnCredited: UnlockedAchievement[] = pcAchievements
          .filter((a) =>
            earnedNames.has(normalizeAchievementName(a.displayName))
          )
          .map((a) => ({ name: a.apiName, unlockTime: Date.now() }));
        if (psnCredited.length === 0) continue;

        const existing =
          (await gameAchievementsSublevel.get(key))?.unlockedAchievements ?? [];
        const merged = mergeUnlocked(
          existing,
          toUnlockedList(pcAchievements),
          psnCredited
        );

        await persistGameAchievements(
          key,
          game,
          toDefinitions(pcAchievements),
          merged
        );

        result.gamesMatched++;
        result.totalUnlocked += psnCredited.length;
      } catch (err) {
        achievementsLogger.warn(
          `[Exophase] PSN import failed for "${game.title}"`,
          err
        );
      }
    }
  } finally {
    fetcher.close();
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  achievementsLogger.log(
    `[Exophase] PSN import complete: matched ${result.gamesMatched}/${result.gamesProcessed} games, credited ${result.totalUnlocked} trophies`
  );
  return result;
}
