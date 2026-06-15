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

/** Writes parsed Exophase achievements into the shared achievement store so the
 *  existing game-details UI renders them with no further changes. */
async function storeExophaseAchievements(
  gameKey: string,
  game: Game,
  achievements: ExophaseAchievement[]
): Promise<void> {
  const definitions: SteamAchievement[] = achievements.map((a) => ({
    name: a.apiName,
    displayName: a.displayName,
    description: a.description,
    icon: a.iconUrl,
    icongray: a.iconUrl,
    hidden: false,
    points: a.points ?? undefined,
  }));

  const unlocked: UnlockedAchievement[] = achievements
    .filter((a) => a.unlocked)
    .map((a) => ({
      name: a.apiName,
      unlockTime: a.unlockTime ?? Date.now(),
    }));

  await gameAchievementsSublevel.put(gameKey, {
    achievements: definitions,
    unlockedAchievements: unlocked,
    updatedAt: Date.now(),
    language: "en",
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
}

const isManaged = (shop: GameShop, prefs: UserPreferences | null): boolean => {
  const managed = prefs?.exophaseManagedPlatforms ?? DEFAULT_MANAGED_SHOPS;
  return managed.includes(shop);
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
  const eligible: Array<[string, Game]> = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game || game.isDeleted) continue;
    const slug = SHOP_TO_EXOPHASE_SLUG[game.shop];
    if (!slug) continue;
    if (!isManaged(game.shop, prefs)) continue;
    eligible.push([key, game]);
  }

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
