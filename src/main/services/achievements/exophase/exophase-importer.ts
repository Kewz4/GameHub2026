import {
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  ExophaseCacheEntry,
  ExophaseSyncReport,
  ExophaseSyncReportGame,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
} from "@types";
import { achievementsLogger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
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
  /** Full sync report for the PSN run so the event can merge it into the
   *  persisted Achievements Sync report (PSN games were previously invisible). */
  report?: ExophaseSyncReport;
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

/**
 * Resolves an Exophase awards page (reflecting the logged-in user's earned
 * state) for a title. When a direct `knownAwardsUrl` is provided (scraped from
 * the account game-list page), we skip the search entirely — this avoids the
 * wrong-locale slug problem where e.g. a Chinese PSN title would match the
 * Chinese Exophase slug instead of the English one. Otherwise we fall back to
 * the title-search path.
 */
async function resolveAwards(
  fetcher: ExophaseFetcher,
  title: string,
  platformSlug?: string,
  playerId?: string,
  knownAwardsUrl?: string
): Promise<{
  achievements: ExophaseAchievement[];
  awardsUrl: string;
  masterId: number | null;
} | null> {
  // Fast path: we already know the URL from the account page — skip search.
  if (knownAwardsUrl) {
    let url = knownAwardsUrl;
    if (playerId) url = `${url}#${playerId}`;
    const settleMs = playerId ? 3_000 : 0;
    const achievements = parseAchievements(await fetcher.fetchHtml(url, settleMs));
    if (achievements.length > 0) {
      return { achievements, awardsUrl: url, masterId: null };
    }
    // If the direct URL produced nothing (e.g. platform mismatch), fall through
    // to title-search so we don't silently drop the game.
  }

  const slugsToTry = platformSlug ? [platformSlug] : [undefined];

  for (const slug of slugsToTry) {
    const candidates = await searchExophaseGames(fetcher, title, slug);
    const match = findBestMatch(title, candidates, slug);
    if (!match) continue;

    let url = awardsUrlFor(match);
    if (!url) continue;

    // Append the Exophase player ID so the page returns the user's earned
    // state. Without this hash, all achievements appear un-earned (data-earned="0").
    if (playerId) url = `${url}#${playerId}`;

    // The #playerId hash tells Exophase to load this user's earned state via
    // XHR AFTER page load. Without a settle delay the data-earned attributes
    // are still all "0" when we scrape. 3 s is enough for the XHR to complete.
    const settleMs = playerId ? 3_000 : 0;
    const achievements = parseAchievements(await fetcher.fetchHtml(url, settleMs));
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
  newlyUnlocked: number,
  verification?: ExophaseSyncReportGame["verificationChecks"],
  debug?: ExophaseSyncReportGame["debug"]
): ExophaseSyncReportGame => ({
  shop,
  objectId,
  title,
  iconUrl,
  newlyUnlocked,
  totalUnlocked: unlocked.length,
  totalAchievements: definitions.length,
  verified: verification
    ? verification.persisted &&
      verification.unlockCountConsistent &&
      verification.noOrphanUnlocks
    : undefined,
  verificationChecks: verification,
  debug,
});

/**
 * Runs 3 post-match integrity checks against what was actually written to the
 * DB for a game, so the sync report can prove the unlock truly landed:
 *   1. persisted          — the achievements entry exists with definitions
 *   2. unlockCountConsistent — game.unlockedAchievementCount === stored unlocks
 *   3. noOrphanUnlocks    — every unlocked apiName exists in the definition set
 */
type VerificationChecks = NonNullable<ExophaseSyncReportGame["verificationChecks"]>;

async function verifyGameAchievements(
  gameKey: string
): Promise<VerificationChecks> {
  const ach = await gameAchievementsSublevel.get(gameKey).catch(() => null);
  const game = await gamesSublevel.get(gameKey).catch(() => null);

  const persisted = Boolean(ach && (ach.achievements?.length ?? 0) > 0);

  const storedUnlocks = ach?.unlockedAchievements ?? [];
  const unlockCountConsistent =
    persisted && (game?.unlockedAchievementCount ?? 0) === storedUnlocks.length;

  const defNames = new Set(
    (ach?.achievements ?? []).map((d) => (d.name ?? "").toUpperCase())
  );
  const noOrphanUnlocks =
    persisted &&
    storedUnlocks.every((u) => defNames.has((u.name ?? "").toUpperCase()));

  return { persisted, unlockCountConsistent, noOrphanUnlocks };
}

/**
 * Handles ONE account game: resolves its awards, matches it to the Hydra
 * catalogue, caches the result (by catalogue id and by title), and applies it
 * to the matching library record when present. Returns a report line plus the
 * count of unlocks credited, or null when nothing resolved.
 */
async function processAccountGame(
  fetcher: ExophaseFetcher,
  accountGame: ExophaseAccountGame
): Promise<{
  report: ExophaseSyncReportGame;
  unlocked: number;
  resolved: boolean;
} | null> {
  // Look up the English catalogue title FIRST so we search Exophase with the
  // canonical English name, not a localized one (e.g. Chinese PSN title). This
  // prevents matching the wrong locale slug (du-shen-ji-… vs immortals-fenyx-…).
  const earlyMatch: CatalogueEntry | null =
    await searchCatalogueForAchievements(accountGame.title);
  const searchTitle = earlyMatch?.title ?? accountGame.title;

  const resolved = await resolveAwards(
    fetcher,
    searchTitle,
    accountGame.platformSlug,
    accountGame.playerId,
    accountGame.awardsUrl
  );
  if (!resolved) {
    achievementsLogger.log(
      `[Exophase account] "${accountGame.title}": no awards resolved — skipping`
    );
    // Still surface a report line (with debug) so the user can see the title
    // was attempted but produced nothing to match.
    return {
      resolved: false,
      unlocked: 0,
      report: buildReportGame(
        "custom",
        "",
        accountGame.title,
        null,
        [],
        [],
        0,
        undefined,
        {
          accountTitle: accountGame.title,
          platformSlug: accountGame.platformSlug,
          awardsUrl: null,
          exophaseDefs: 0,
          exophaseUnlocked: 0,
          catalogueMatched: false,
          defSource: "none",
          inLibrary: false,
          note: "No Exophase awards page resolved for this title.",
        }
      ),
    };
  }

  const definitions = toDefinitions(resolved.achievements);
  const unlocked = toUnlockedList(resolved.achievements);

  // Use the catalogue match we found before the Exophase search (earlyMatch).
  const catalogueMatch: CatalogueEntry | null = earlyMatch;

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
  // Games NOT in the library are intentionally skipped — we cache by title so
  // they light up if the user adds them later, but we never auto-add to library.
  let newlyUnlocked = 0;
  const reportObjectId = objectId ?? "";
  let iconUrl: string | null = null;
  // Default to Exophase definition count; overridden below if HydraAPI data exists.
  let reportTotalAchievements = definitions.length;
  let verification: ExophaseSyncReportGame["verificationChecks"] = undefined;
  let defSource: "hydraapi" | "exophase" | "none" = "exophase";
  let inLibrary = false;

  if (catalogueMatch && objectId) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const existingAchData = await gameAchievementsSublevel
      .get(gameKey)
      .catch(() => null);
    const prevUnlockedCount = existingAchData?.unlockedAchievements?.length ?? 0;

    if (game && !game.isDeleted) {
      inLibrary = true;

      // If HydraAPI definitions exist, the report should reflect their count.
      if (
        existingAchData?.source !== "exophase" &&
        existingAchData?.achievements?.length
      ) {
        reportTotalAchievements = existingAchData.achievements.length;
        defSource = "hydraapi";
      }

      iconUrl = game.iconUrl ?? null;
      await applyCachedAchievements(gameKey, game);

      // Re-read after apply and count how many unlocks were added.
      const afterAchData = await gameAchievementsSublevel
        .get(gameKey)
        .catch(() => null);
      const afterUnlockedCount = afterAchData?.unlockedAchievements?.length ?? 0;
      newlyUnlocked = Math.max(0, afterUnlockedCount - prevUnlockedCount);

      if (afterAchData?.achievements?.length) {
        reportTotalAchievements = afterAchData.achievements.length;
      }

      // Three post-match verification checks proving the unlock truly landed.
      const checks = await verifyGameAchievements(gameKey);
      verification = checks;
      const allPassed =
        checks.persisted &&
        checks.unlockCountConsistent &&
        checks.noOrphanUnlocks;
      achievementsLogger.log(
        `[Exophase verify] "${title}" ${shop}:${objectId} → ${
          allPassed ? "OK" : "FAILED"
        } (persisted=${checks.persisted}, unlockCount=${checks.unlockCountConsistent}, noOrphans=${checks.noOrphanUnlocks})`
      );
    } else {
      // Game is not in the library, but we still write achievements to the
      // achievements sublevel so they're tracked for the sync report and
      // available as soon as the user adds the game later.
      if (existingAchData?.source !== "exophase" && existingAchData?.achievements?.length) {
        reportTotalAchievements = existingAchData.achievements.length;
        defSource = "hydraapi";
      }
      await gameAchievementsSublevel.put(gameKey, {
        achievements: definitions,
        unlockedAchievements: unlocked,
        updatedAt: Date.now(),
        language: "en",
        source: "exophase" as const,
      }).catch(() => {});
      newlyUnlocked = Math.max(0, unlocked.length - prevUnlockedCount);
      achievementsLogger.log(
        `[Exophase] "${title}" not in library — wrote ${unlocked.length} unlocks to gameAchievementsSublevel`
      );
    }
  }

  const debugInfo: ExophaseSyncReportGame["debug"] = {
    accountTitle: accountGame.title,
    platformSlug: accountGame.platformSlug,
    awardsUrl: resolved.awardsUrl,
    exophaseDefs: definitions.length,
    exophaseUnlocked: unlocked.length,
    catalogueMatched: Boolean(catalogueMatch),
    catalogueTitle: catalogueMatch?.title,
    defSource,
    inLibrary,
    note: !catalogueMatch
      ? "No Hydra catalogue entry matched — achievements cached by title only."
      : !inLibrary
        ? "Game matched catalogue but is not in your library."
        : undefined,
  };

  return {
    resolved: true,
    report: buildReportGame(
      shop,
      reportObjectId,
      title,
      iconUrl,
      // Use HydraAPI-aware total for the report definition count.
      { length: reportTotalAchievements } as SteamAchievement[],
      unlocked,
      newlyUnlocked,
      verification,
      debugInfo
    ),
    unlocked: unlocked.length,
  };
}

/** Exophase platform slugs considered "PC" (excludes PSN/console-only). */
const PC_PLATFORM_SLUGS = new Set([
  "steam",
  "epic",
  "gog",
  "origin",
  "ubisoft",
  "blizzard",
  "xbox",
]);

/** Exophase platform slugs considered "PlayStation" (PSN only). */
const PSN_PLATFORM_SLUGS = new Set(["psn"]);

/**
 * ACCOUNT-DRIVEN sync — the primary path.
 *
 * Enumerates every game on the user's Exophase account filtered by the `mode`:
 *   "pc"  — PC storefronts only (Steam, Epic, GOG, Xbox, EA, Ubisoft, Blizzard)
 *   "psn" — PlayStation Network trophies only
 *   "all" — every platform (legacy; not exposed in UI)
 *
 * Matches each game to the Hydra catalogue and applies/caches achievements.
 * Games with no catalogue match are cached by title for later custom-game use.
 * Games NOT in the library are intentionally skipped (never auto-added).
 */
export async function syncExophaseAccount(
  onProgress?: (p: ExophaseSyncProgress) => void,
  mode: "pc" | "psn" | "all" = "all"
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
        "[Exophase account] no account games enumerated — check the profile is public and the username is correct"
      );
      return { ...result, error: "No games found on your Exophase account." };
    }

    // Filter by mode so PC sync never touches PSN trophies and vice versa.
    const filteredGames =
      mode === "pc"
        ? accountGames.filter((g) => PC_PLATFORM_SLUGS.has(g.platformSlug))
        : mode === "psn"
          ? accountGames.filter((g) => PSN_PLATFORM_SLUGS.has(g.platformSlug))
          : accountGames;

    achievementsLogger.log(
      `[Exophase account] mode="${mode}" → ${filteredGames.length}/${accountGames.length} games after platform filter`
    );

    let index = 0;
    for (const accountGame of filteredGames) {
      index++;
      result.gamesProcessed++;
      onProgress?.({
        current: index,
        total: filteredGames.length,
        title: accountGame.title,
        phase: "Matching Exophase games",
      });

      try {
        const outcome = await processAccountGame(fetcher, accountGame);
        if (outcome) {
          if (outcome.resolved) {
            result.gamesWithAchievements++;
            result.totalUnlocked += outcome.unlocked;
          }
          // Always push report (includes unresolved titles for debug view).
          reportGames.push(outcome.report);
        }
      } catch (err) {
        achievementsLogger.warn(
          `[Exophase account] failed for "${accountGame.title}"`,
          err
        );
      }
    }

    // NOTE: We intentionally do NOT call applyCacheToLibrary() here.
    // That function is triggered by the library sync events (Steam/GOG/Epic/scan)
    // after they actually add games. Calling it here would apply achievements to
    // every game that exists in the library, including ones the user considers
    // "ghost" entries added silently by mergeWithRemoteGames. All Exophase
    // account games that matched a library entry were already handled above
    // via applyCachedAchievements in processAccountGame.
  } finally {
    fetcher.close();
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");

  const gamesUpdated = reportGames.filter((g) => g.newlyUnlocked > 0).length;
  const totalNewlyUnlocked = reportGames.reduce(
    (n, g) => n + g.newlyUnlocked,
    0
  );

  // Deduplicate by shop+objectId — a game can appear multiple times if the
  // user has it on both a PC store and PSN, or if duplicate account entries
  // exist. Keep the entry with the highest unlocked count.
  const dedupedGames = [
    ...reportGames
      .filter((g) => g.objectId)
      .reduce((map, g) => {
        const key = `${g.shop}:${g.objectId}`;
        const prev = map.get(key);
        if (!prev || g.totalUnlocked > prev.totalUnlocked) map.set(key, g);
        return map;
      }, new Map<string, ExophaseSyncReportGame>())
      .values(),
  ];

  result.report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    gamesProcessed: result.gamesProcessed,
    gamesUpdated,
    totalNewlyUnlocked,
    games: dedupedGames,
    psnDetected: [],
  };

  achievementsLogger.log(
    `[Exophase account] done: ${result.gamesWithAchievements}/${result.gamesProcessed} resolved, ${result.totalUnlocked} unlocked`
  );
  return result;
}

/**
 * "Sync Achievements Now" — PC storefronts only (Steam, Epic, GOG, Xbox,
 * EA/Origin, Ubisoft, Blizzard). PSN trophies are intentionally excluded so
 * they don't bleed into the PC library sync.
 */
export const syncExophaseAchievements = (
  onProgress?: (p: ExophaseSyncProgress) => void
) => syncExophaseAccount(onProgress, "pc");

/**
 * "Import PlayStation Achievements" — PSN trophies only. Matches PS trophies
 * to their PC counterparts in the Hydra catalogue and unlocks them there.
 */
export async function importPlaystationAchievements(
  onProgress?: (p: ExophaseSyncProgress) => void
): Promise<ExophasePsnImportResult> {
  const r = await syncExophaseAccount(onProgress, "psn");
  return {
    gamesProcessed: r.gamesProcessed,
    gamesMatched: r.gamesWithAchievements,
    totalUnlocked: r.totalUnlocked,
    error: r.error,
    report: r.report,
  };
}
