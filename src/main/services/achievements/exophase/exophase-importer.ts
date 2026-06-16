import { gameAchievementsSublevel, gamesSublevel } from "@main/level";
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
import {
  searchCatalogueForAchievements,
  type CatalogueEntry,
} from "./exophase-catalogue";
import { getPrefs, toDefinitions } from "./exophase-cache";

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
  phase?: string;
}


export const toUnlockedList = (
  achievements: ExophaseAchievement[]
): UnlockedAchievement[] =>
  achievements
    .filter((a) => a.unlocked)
    .map((a) => ({ name: a.apiName, unlockTime: a.unlockTime ?? Date.now() }));

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
  achievementsLogger.log(
    `[Exophase] persisting ${definitions.length} definitions, ${unlocked.length} unlocked for "${game.title}" [${gameKey}]`
  );
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
  achievementsLogger.log(
    `[Exophase] collectEligibleGames: ${eligible.length} eligible`
  );
  return eligible;
};

/**
 * Sync PC achievements for every eligible library game.
 *
 * Uses STRICT platform matching — findBestMatch now prefers candidates that
 * actually belong to the requested platform slug, so Steam games don't
 * accidentally resolve to PSN/Xbox/Android awards pages.
 */
export async function syncExophaseAchievements(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophaseSyncResult> {
  const result: ExophaseSyncResult = {
    gamesProcessed: 0,
    gamesWithAchievements: 0,
    totalUnlocked: 0,
  };

  achievementsLogger.log("[Exophase] syncExophaseAchievements starting…");

  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) {
    achievementsLogger.warn("[Exophase] sync aborted: no Exophase user connected");
    return { ...result, error: "Exophase account not connected." };
  }
  if (prefs.exophaseEnabled === false) {
    achievementsLogger.warn("[Exophase] sync aborted: Exophase disabled");
    return { ...result, error: "Exophase is disabled." };
  }

  achievementsLogger.log(
    `[Exophase] PC sync as user "${prefs.exophaseUserId}"`
  );

  const eligible = await collectEligibleGames(prefs);

  const fetcher = new ExophaseFetcher();
  try {
    for (const [key, game] of eligible) {
      result.gamesProcessed++;
      onProgress?.({
        current: result.gamesProcessed,
        total: eligible.length,
        title: game.title,
        phase: "Syncing achievements",
      });

      const slug = SHOP_TO_EXOPHASE_SLUG[game.shop]!;
      achievementsLogger.log(
        `[Exophase] [${result.gamesProcessed}/${eligible.length}] "${game.title}" slug=${slug}`
      );

      try {
        const candidates = await searchExophaseGames(fetcher, game.title, slug);
        achievementsLogger.log(
          `[Exophase] search "${game.title}" slug="${slug}" → ${candidates.length} candidates`
        );

        const match = findBestMatch(game.title, candidates, slug);
        if (!match) {
          achievementsLogger.log(
            `[Exophase] no platform match for "${game.title}" on "${slug}" — skipping`
          );
          continue;
        }

        const url = awardsUrlFor(match);
        achievementsLogger.log(
          `[Exophase] matched "${match.title}" env="${match.environment_slug}" url="${url}"`
        );
        if (!url) continue;

        const html = await fetcher.fetchHtml(url);
        const achievements = parseAchievements(html);
        const unlockedCount = achievements.filter((a) => a.unlocked).length;
        achievementsLogger.log(
          `[Exophase] "${game.title}": ${achievements.length} achievements, ${unlockedCount} unlocked`
        );
        if (achievements.length === 0) continue;

        await storeExophaseAchievements(key, game, achievements);
        result.gamesWithAchievements++;
        result.totalUnlocked += unlockedCount;
      } catch (err) {
        achievementsLogger.warn(
          `[Exophase] failed syncing "${game.title}"`,
          err
        );
      }
    }
  } finally {
    fetcher.close();
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  achievementsLogger.log(
    `[Exophase] PC sync done: ${result.gamesWithAchievements}/${result.gamesProcessed} games, ${result.totalUnlocked} unlocked`
  );
  return result;
}

/**
 * Resolves PC achievement definitions for a PSN game and credits the user's
 * earned trophies onto the given LIBRARY game. Returns the number of
 * achievements credited (0 when nothing applies). Shared by the profile-driven
 * and library-driven PSN import paths.
 *
 * Resolution order for the PC achievement set:
 *   1. The Hydra catalogue's real platform (e.g. Immortals → Epic/Ubisoft).
 *   2. The library shop, as a fallback.
 *   3. The raw PSN trophy set, when no PC Exophase page exists or none of its
 *      names line up with the earned trophies (PS4-only titles).
 */
async function creditPsnTrophies(
  fetcher: ExophaseFetcher,
  gameKey: string,
  game: Game,
  psnTrophies: ExophaseAchievement[],
  catalogueMatch: CatalogueEntry | null
): Promise<number> {
  const earnedTrophies = psnTrophies.filter((t) => t.unlocked);
  if (earnedTrophies.length === 0) return 0;

  const earnedNames = new Set(
    earnedTrophies.map((t) => normalizeAchievementName(t.displayName))
  );

  const pcSlugCandidates: string[] = [];
  if (catalogueMatch) {
    const cslug = SHOP_TO_EXOPHASE_SLUG[catalogueMatch.shop];
    if (cslug) pcSlugCandidates.push(cslug);
  }
  const librarySlug = SHOP_TO_EXOPHASE_SLUG[game.shop];
  if (librarySlug && !pcSlugCandidates.includes(librarySlug)) {
    pcSlugCandidates.push(librarySlug);
  }
  const pcTitle = catalogueMatch?.title ?? game.title;

  let pcAchievements: ExophaseAchievement[] = [];
  let pcSlugUsed: string | null = null;
  for (const slug of pcSlugCandidates) {
    const pcCandidates = await searchExophaseGames(fetcher, pcTitle, slug);
    const pcMatch = findBestMatch(pcTitle, pcCandidates, slug);
    achievementsLogger.log(
      `[Exophase] PSN "${pcTitle}" PC try slug="${slug}": ${pcCandidates.length} candidates, match=${pcMatch?.title ?? "none"}`
    );
    if (!pcMatch) continue;
    const parsed = parseAchievements(
      await fetcher.fetchHtml(awardsUrlFor(pcMatch))
    );
    if (parsed.length > 0) {
      achievementsLogger.log(
        `[Exophase] PSN "${pcTitle}": ${parsed.length} PC achievements from slug="${slug}"`
      );
      pcAchievements = parsed;
      pcSlugUsed = slug;
      break;
    }
  }

  const existing = await gameAchievementsSublevel.get(gameKey).catch(() => null);

  let definitions: SteamAchievement[];
  let credited: UnlockedAchievement[];

  if (pcAchievements.length > 0) {
    const psnCredited: UnlockedAchievement[] = pcAchievements
      .filter((a) => earnedNames.has(normalizeAchievementName(a.displayName)))
      .map((a) => {
        const matching = earnedTrophies.find(
          (t) =>
            normalizeAchievementName(t.displayName) ===
            normalizeAchievementName(a.displayName)
        );
        return {
          name: a.apiName,
          unlockTime: matching?.unlockTime ?? Date.now(),
        };
      });

    if (psnCredited.length === 0) {
      achievementsLogger.log(
        `[Exophase] PSN "${pcTitle}": PC page (slug=${pcSlugUsed}) had no name matches — using PSN trophies`
      );
      definitions = toDefinitions(psnTrophies);
      credited = mergeUnlocked(
        existing?.unlockedAchievements ?? [],
        toUnlockedList(psnTrophies)
      );
    } else {
      achievementsLogger.log(
        `[Exophase] PSN "${pcTitle}": ${psnCredited.length}/${pcAchievements.length} PC achievements credited from ${earnedTrophies.length} PSN trophies`
      );
      definitions = toDefinitions(pcAchievements);
      credited = mergeUnlocked(
        existing?.unlockedAchievements ?? [],
        toUnlockedList(pcAchievements),
        psnCredited
      );
    }
  } else {
    achievementsLogger.log(
      `[Exophase] PSN "${game.title}": no PC page — crediting ${psnTrophies.length} PSN trophy definitions directly`
    );
    definitions = toDefinitions(psnTrophies);
    credited = mergeUnlocked(
      existing?.unlockedAchievements ?? [],
      toUnlockedList(psnTrophies)
    );
  }

  if (credited.length === 0) return 0;

  await persistGameAchievements(gameKey, game, definitions, credited);

  // Infer playtime from PSN trophy unlock span when the game has none.
  const currentPlaytime = game.playTimeInMilliseconds ?? 0;
  if (currentPlaytime === 0 && earnedTrophies.length >= 2) {
    const timestamps = earnedTrophies
      .map((t) => t.unlockTime)
      .filter((t): t is number => t !== null && t > 0)
      .sort((a, b) => a - b);
    if (timestamps.length >= 2) {
      const inferredMs = timestamps[timestamps.length - 1] - timestamps[0];
      achievementsLogger.log(
        `[Exophase] PSN "${game.title}": inferring ${Math.round(inferredMs / 60000)} min playtime from trophy span`
      );
      await gamesSublevel.put(gameKey, {
        ...game,
        playTimeInMilliseconds: inferredMs,
        achievementCount: definitions.length,
        unlockedAchievementCount: credited.length,
      });
    }
  }

  return credited.length;
}

/**
 * PlayStation trophy import.
 *
 * Iterates every library game and searches it on PSN via the verified Exophase
 * search API (results are platform-tagged by `environment_slug`, so we know a
 * hit genuinely comes from PlayStation). When the user has earned trophies, we
 * match the game to the Hydra catalogue and credit those trophies onto the
 * library game — using PC achievement definitions when available, otherwise the
 * PSN trophy set directly.
 *
 * This correctly handles Playnite-imported PS4 titles (Immortals Fenyx Rising,
 * Fall Guys, …): their library shop is a fake "steam"/"gog", but we don't trust
 * it — the catalogue resolves the real PC platform, and the trophy set is the
 * fallback when no PC page exists.
 *
 * Note: this is entirely separate from `syncExophaseAchievements`, which keeps
 * syncing your Steam / Epic / GOG / Xbox achievements on their own platforms.
 */
export async function importPlaystationAchievements(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophasePsnImportResult> {
  const result: ExophasePsnImportResult = {
    gamesProcessed: 0,
    gamesMatched: 0,
    totalUnlocked: 0,
  };

  achievementsLogger.log("[Exophase] importPlaystationAchievements starting…");

  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) {
    achievementsLogger.warn("[Exophase] PSN import aborted: no Exophase user");
    return { ...result, error: "Exophase account not connected." };
  }
  if (prefs.exophaseEnabled === false) {
    achievementsLogger.warn("[Exophase] PSN import aborted: disabled");
    return { ...result, error: "Exophase is disabled." };
  }

  achievementsLogger.log(
    `[Exophase] PSN import as user "${prefs.exophaseUserId}"`
  );

  // Scan ALL library games (not just managed) so Playnite-imported PS4 titles
  // can receive trophies even when their library shop is "steam"/"gog"/etc.
  const allGames: Array<[string, Game]> = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game || game.isDeleted) continue;
    allGames.push([key, game]);
  }
  achievementsLogger.log(
    `[Exophase] PSN import: ${allGames.length} library games to check`
  );

  const fetcher = new ExophaseFetcher();
  try {
    for (const [key, game] of allGames) {
      result.gamesProcessed++;
      onProgress?.({
        current: result.gamesProcessed,
        total: allGames.length,
        title: game.title,
        phase: "Looking up PSN trophies",
      });

      achievementsLogger.log(
        `[Exophase] PSN [${result.gamesProcessed}/${allGames.length}] "${game.title}" (${game.shop})`
      );

      try {
        // 1. Find this game's PSN entry via the search API. `environment_slug`
        // on each result guarantees we only accept genuine PlayStation hits.
        const psnCandidates = await searchExophaseGames(
          fetcher,
          game.title,
          "psn"
        );
        achievementsLogger.log(
          `[Exophase] PSN search "${game.title}" → ${psnCandidates.length} candidates`
        );

        const psnMatch = findBestMatch(game.title, psnCandidates, "psn");
        if (!psnMatch) {
          achievementsLogger.log(
            `[Exophase] PSN no match for "${game.title}" — skipping`
          );
          continue;
        }
        achievementsLogger.log(
          `[Exophase] PSN matched "${psnMatch.title}" env="${psnMatch.environment_slug}"`
        );

        // 2. Fetch the user's earned PSN trophies for this entry.
        const psnTrophies = parseAchievements(
          await fetcher.fetchHtml(awardsUrlFor(psnMatch))
        );
        const earned = psnTrophies.filter((t) => t.unlocked);
        achievementsLogger.log(
          `[Exophase] PSN "${game.title}": ${psnTrophies.length} trophies, ${earned.length} earned`
        );
        if (earned.length === 0) {
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": no earned trophies — skipping`
          );
          continue;
        }

        // 3. Match to the Hydra catalogue (for the real PC platform) and credit.
        const catalogueMatch = await searchCatalogueForAchievements(game.title);
        if (catalogueMatch) {
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}" → catalogue ${catalogueMatch.shop}:${catalogueMatch.objectId} "${catalogueMatch.title}"`
          );
        } else {
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": no Hydra catalogue match`
          );
        }

        const n = await creditPsnTrophies(
          fetcher,
          key,
          game,
          psnTrophies,
          catalogueMatch
        );
        if (n > 0) {
          result.gamesMatched++;
          result.totalUnlocked += n;
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": credited ${n} trophies`
          );
        }
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
    `[Exophase] PSN import done: matched ${result.gamesMatched}/${result.gamesProcessed} games, credited ${result.totalUnlocked} trophies`
  );
  return result;
}
