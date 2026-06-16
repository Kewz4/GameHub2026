import {
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  ExophaseCacheEntry,
  ExophaseSyncReport,
  ExophaseSyncReportGame,
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
  normalizeExophaseTitle,
  parseAchievements,
  searchExophaseGames,
  type ExophaseAchievement,
} from "./exophase-api";
import {
  fetchExophaseAccountGames,
  type ExophaseAccountGame,
} from "./exophase-account";
import {
  searchCatalogueForAchievements,
  type CatalogueEntry,
} from "./exophase-catalogue";
import {
  applyCacheToLibrary,
  applyCachedAchievements,
  getPrefs,
  putCacheEntry,
  toDefinitions,
} from "./exophase-cache";

export interface ExophaseSyncResult {
  gamesProcessed: number;
  gamesWithAchievements: number;
  totalUnlocked: number;
  report?: ExophaseSyncReport;
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

const isManaged = (shop: GameShop, prefs: UserPreferences | null): boolean => {
  const managed = prefs?.exophaseManagedPlatforms ?? DEFAULT_MANAGED_SHOPS;
  return managed.includes(shop);
};

/**
 * Resolves an Exophase awards page (reflecting the logged-in user's earned
 * state) for a title. When the platform is known from the profile we constrain
 * the search to it; otherwise we search across platforms and take the best
 * title match. Returns the parsed achievements plus provenance, or null.
 */
async function resolveAwards(
  fetcher: ExophaseFetcher,
  title: string,
  platformSlug?: string
): Promise<{
  achievements: ExophaseAchievement[];
  awardsUrl: string;
  masterId: number | null;
} | null> {
  const slugsToTry = platformSlug ? [platformSlug] : [undefined];

  for (const slug of slugsToTry) {
    const candidates = await searchExophaseGames(fetcher, title, slug);
    const match = findBestMatch(title, candidates, slug);
    if (!match) continue;

    const url = awardsUrlFor(match);
    if (!url) continue;

    const achievements = parseAchievements(await fetcher.fetchHtml(url));
    if (achievements.length === 0) continue;

    return { achievements, awardsUrl: url, masterId: match.master_id ?? null };
  }

  return null;
}

const buildReportGame = (
  shop: GameShop,
  objectId: string,
  title: string,
  iconUrl: string | null,
  definitions: SteamAchievement[],
  unlocked: UnlockedAchievement[],
  newlyUnlocked: number
): ExophaseSyncReportGame => ({
  shop,
  objectId,
  title,
  iconUrl,
  newlyUnlocked,
  totalUnlocked: unlocked.length,
  totalAchievements: definitions.length,
});

/**
 * Handles ONE account game: resolves its awards, matches it to the Hydra
 * catalogue, caches the result (by catalogue id and by title), and applies it
 * to the matching library record when present. Returns a report line plus the
 * count of unlocks credited, or null when nothing resolved.
 */
async function processAccountGame(
  fetcher: ExophaseFetcher,
  accountGame: ExophaseAccountGame
): Promise<{ report: ExophaseSyncReportGame; unlocked: number } | null> {
  const resolved = await resolveAwards(
    fetcher,
    accountGame.title,
    accountGame.platformSlug
  );
  if (!resolved) {
    achievementsLogger.log(
      `[Exophase account] "${accountGame.title}": no awards resolved — skipping`
    );
    return null;
  }

  const definitions = toDefinitions(resolved.achievements);
  const unlocked = toUnlockedList(resolved.achievements);

  // Match to the Hydra catalogue (PC-only). PSN/Xbox games resolve to their PC
  // counterpart; titles with no catalogue entry are cached by title only so a
  // later custom game inherits them.
  const catalogueMatch: CatalogueEntry | null =
    await searchCatalogueForAchievements(accountGame.title);

  const shop: GameShop = catalogueMatch?.shop ?? "custom";
  const objectId = catalogueMatch?.objectId;
  const title = catalogueMatch?.title ?? accountGame.title;

  const entry: ExophaseCacheEntry = {
    shop,
    objectId: objectId ?? null,
    normalizedTitle: normalizeExophaseTitle(title),
    title,
    masterId: resolved.masterId,
    awardsUrl: resolved.awardsUrl,
    definitions,
    unlocked,
    updatedAt: Date.now(),
  };
  await putCacheEntry(entry);

  achievementsLogger.log(
    `[Exophase account] "${accountGame.title}" → ${
      catalogueMatch
        ? `catalogue ${shop}:${objectId} ("${title}")`
        : "custom (no catalogue match)"
    }: ${definitions.length} defs, ${unlocked.length} unlocked`
  );

  // Apply directly to the matching library record (catalogue id) if present.
  let newlyUnlocked = unlocked.length;
  const reportObjectId = objectId ?? "";
  let iconUrl: string | null = null;

  if (catalogueMatch && objectId) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (game && !game.isDeleted) {
      const prevUnlocked = new Set(
        (
          await gameAchievementsSublevel
            .get(gameKey)
            .then((v) => v?.unlockedAchievements ?? [])
            .catch(() => [])
        ).map((u) => (u.name ?? "").toUpperCase())
      );
      newlyUnlocked = unlocked.filter(
        (u) => !prevUnlocked.has((u.name ?? "").toUpperCase())
      ).length;
      iconUrl = game.iconUrl ?? null;
      await applyCachedAchievements(gameKey, game);
    }
  }

  return {
    report: buildReportGame(
      shop,
      reportObjectId,
      title,
      iconUrl,
      definitions,
      unlocked,
      newlyUnlocked
    ),
    unlocked: unlocked.length,
  };
}

/**
 * ACCOUNT-DRIVEN sync — the primary path.
 *
 * Enumerates every game on the user's Exophase account (all platforms), and for
 * each one matches it to the Hydra catalogue and applies/caches its
 * achievements. Games with no catalogue match are cached by title so a custom
 * game added later lights up from the shared R2 cache.
 *
 * Falls back to the legacy library-driven scan only when account enumeration
 * yields nothing (e.g. the profile couldn't be read), so behaviour never
 * regresses.
 */
export async function syncExophaseAccount(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophaseSyncResult> {
  const result: ExophaseSyncResult = {
    gamesProcessed: 0,
    gamesWithAchievements: 0,
    totalUnlocked: 0,
  };

  const startedAt = new Date().toISOString();
  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) {
    return { ...result, error: "Exophase account not connected." };
  }
  if (prefs.exophaseEnabled === false) {
    return { ...result, error: "Exophase is disabled." };
  }

  achievementsLogger.log(
    `[Exophase account] sync as "${prefs.exophaseUserId}" starting…`
  );

  const fetcher = new ExophaseFetcher();
  const reportGames: ExophaseSyncReportGame[] = [];

  try {
    const accountGames = await fetchExophaseAccountGames(
      fetcher,
      prefs.exophaseUserId
    );
    achievementsLogger.log(
      `[Exophase account] enumerated ${accountGames.length} account games`
    );

    if (accountGames.length === 0) {
      achievementsLogger.warn(
        "[Exophase account] no account games found — falling back to library scan"
      );
      const fallback = await syncLibraryFallback(fetcher, prefs, onProgress);
      return fallback;
    }

    let index = 0;
    for (const accountGame of accountGames) {
      index++;
      result.gamesProcessed++;
      onProgress?.({
        current: index,
        total: accountGames.length,
        title: accountGame.title,
        phase: "Matching Exophase games",
      });

      try {
        const outcome = await processAccountGame(fetcher, accountGame);
        if (outcome) {
          result.gamesWithAchievements++;
          result.totalUnlocked += outcome.unlocked;
          reportGames.push(outcome.report);
        }
      } catch (err) {
        achievementsLogger.warn(
          `[Exophase account] failed for "${accountGame.title}"`,
          err
        );
      }
    }

    // Light up any library/custom games that matched cache by title but weren't
    // directly applied above (e.g. catalogue had no objectId, or custom games).
    await applyCacheToLibrary().catch(() => 0);
  } finally {
    fetcher.close();
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");

  result.report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    gamesProcessed: result.gamesProcessed,
    gamesUpdated: reportGames.filter((g) => g.newlyUnlocked > 0).length,
    totalNewlyUnlocked: reportGames.reduce((n, g) => n + g.newlyUnlocked, 0),
    games: reportGames.filter((g) => g.newlyUnlocked > 0),
    psnDetected: [],
  };

  achievementsLogger.log(
    `[Exophase account] done: ${result.gamesWithAchievements}/${result.gamesProcessed} resolved, ${result.totalUnlocked} unlocked`
  );
  return result;
}

/**
 * Legacy library-driven scan, retained ONLY as a fallback for when account
 * enumeration returns nothing. Iterates managed library games and resolves each
 * against Exophase directly.
 */
async function syncLibraryFallback(
  fetcher: ExophaseFetcher,
  prefs: UserPreferences | null,
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophaseSyncResult> {
  const result: ExophaseSyncResult = {
    gamesProcessed: 0,
    gamesWithAchievements: 0,
    totalUnlocked: 0,
  };

  const eligible: Array<[string, Game]> = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game || game.isDeleted) continue;
    if (!SHOP_TO_EXOPHASE_SLUG[game.shop]) continue;
    if (!isManaged(game.shop, prefs)) continue;
    eligible.push([key, game]);
  }

  for (const [key, game] of eligible) {
    result.gamesProcessed++;
    onProgress?.({
      current: result.gamesProcessed,
      total: eligible.length,
      title: game.title,
      phase: "Syncing achievements",
    });

    try {
      const slug = SHOP_TO_EXOPHASE_SLUG[game.shop]!;
      const resolved = await resolveAwards(fetcher, game.title, slug);
      if (!resolved) continue;

      const definitions = toDefinitions(resolved.achievements);
      const unlocked = toUnlockedList(resolved.achievements);

      await putCacheEntry({
        shop: game.shop,
        objectId: game.objectId,
        normalizedTitle: normalizeExophaseTitle(game.title),
        title: game.title,
        masterId: resolved.masterId,
        awardsUrl: resolved.awardsUrl,
        definitions,
        unlocked,
        updatedAt: Date.now(),
      });

      await applyCachedAchievements(key, game);
      result.gamesWithAchievements++;
      result.totalUnlocked += unlocked.length;
    } catch (err) {
      achievementsLogger.warn(
        `[Exophase account] fallback failed for "${game.title}"`,
        err
      );
    }
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");
  return result;
}

/** Backwards-compatible export: the manual "Sync achievements" button. */
export const syncExophaseAchievements = syncExophaseAccount;

/**
 * Backwards-compatible export for the "Import PlayStation trophies" button. PSN
 * games are now handled by the unified account sync (their trophies come back
 * as part of the account game list), so this simply runs it and reshapes the
 * result.
 */
export async function importPlaystationAchievements(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophasePsnImportResult> {
  const r = await syncExophaseAccount(onProgress);
  return {
    gamesProcessed: r.gamesProcessed,
    gamesMatched: r.gamesWithAchievements,
    totalUnlocked: r.totalUnlocked,
    error: r.error,
  };
}
