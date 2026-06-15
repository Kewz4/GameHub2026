import {
  db,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  ExophaseSyncReport,
  ExophaseSyncReportGame,
  Game,
  UnlockedAchievement,
} from "@types";
import { achievementsLogger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import { SHOP_TO_EXOPHASE_SLUG } from "./constants";
import { ExophaseFetcher } from "./exophase-web";
import {
  awardsUrlFor,
  findBestMatch,
  normalizeExophaseTitle,
  parseAchievements,
  searchExophaseGames,
} from "./exophase-api";
import {
  applyCacheToLibrary,
  getPrefs,
  isManagedShop,
  pullSharedCache,
  pushSharedCache,
  putCacheEntry,
  toDefinitions,
} from "./exophase-cache";

/** Cap PSN-detection lookups per run so the background pass stays cheap. */
const MAX_PSN_PROBES = 15;

let running = false;

const collectEligibleGames = async (
  prefs: Awaited<ReturnType<typeof getPrefs>>
): Promise<Array<[string, Game]>> => {
  const eligible: Array<[string, Game]> = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (!game || game.isDeleted) continue;
    if (!isManagedShop(game.shop, prefs)) continue;
    eligible.push([key, game]);
  }
  return eligible;
};

/**
 * The background achievement pass. Runs on startup and every 2 hours:
 *   1. pull the shared definition cache from R2 and apply it library-wide (fast)
 *   2. for each managed game, fetch the user's earned state from Exophase,
 *      refresh the cached definitions, and credit newly-unlocked achievements
 *   3. opportunistically flag games that also exist on PSN (bounded probes)
 *   4. push the refreshed cache back to R2 and, if anything changed, raise the
 *      "Achievements Sync finished" notification with a click-through report
 *
 * No-ops cleanly when Exophase isn't connected/enabled.
 */
export const runExophaseBackgroundSync = async (): Promise<void> => {
  if (running) return;

  const prefs = await getPrefs();
  if (!prefs?.exophaseUserId) return;
  if (prefs.exophaseEnabled === false) return;

  running = true;
  const startedAt = new Date().toISOString();
  const reportGames: ExophaseSyncReportGame[] = [];
  const psnDetected: ExophaseSyncReportGame[] = [];
  let totalNewlyUnlocked = 0;
  let gamesUpdated = 0;
  let psnProbes = 0;

  try {
    // 1. Merge the community cache, then light up newly-added games instantly.
    await pullSharedCache().catch(() => 0);
    await applyCacheToLibrary().catch(() => 0);

    const eligible = await collectEligibleGames(prefs);
    const fetcher = new ExophaseFetcher();

    try {
      for (const [key, game] of eligible) {
        try {
          const slug = SHOP_TO_EXOPHASE_SLUG[game.shop]!;
          const candidates = await searchExophaseGames(
            fetcher,
            game.title,
            slug
          );
          const match = findBestMatch(game.title, candidates, slug);
          if (!match) continue;

          const url = awardsUrlFor(match);
          if (!url) continue;

          const parsed = parseAchievements(await fetcher.fetchHtml(url));
          if (parsed.length === 0) continue;

          const definitions = toDefinitions(parsed);

          // Refresh the shared cache for this title.
          await putCacheEntry({
            shop: game.shop,
            normalizedTitle: normalizeExophaseTitle(game.title),
            title: game.title,
            masterId: match.master_id ?? null,
            awardsUrl: url,
            definitions,
            updatedAt: Date.now(),
          });

          // Diff against the previously-stored unlocked set.
          const existing = await gameAchievementsSublevel
            .get(key)
            .catch(() => null);
          const prevUnlocked = new Set(
            (existing?.unlockedAchievements ?? []).map((u) =>
              (u.name ?? "").toUpperCase()
            )
          );

          const unlocked: UnlockedAchievement[] = parsed
            .filter((a) => a.unlocked)
            .map((a) => ({
              name: a.apiName,
              unlockTime: a.unlockTime ?? Date.now(),
            }));

          const newlyUnlocked = unlocked.filter(
            (u) => !prevUnlocked.has((u.name ?? "").toUpperCase())
          ).length;

          await gameAchievementsSublevel.put(key, {
            achievements: definitions,
            unlockedAchievements: unlocked,
            updatedAt: Date.now(),
            language: "en",
            source: "exophase",
          });
          await gamesSublevel.put(key, {
            ...game,
            achievementCount: definitions.length,
            unlockedAchievementCount: unlocked.length,
          });
          WindowManager.mainWindow?.webContents.send(
            `on-update-achievements-${game.objectId}-${game.shop}`,
            unlocked
          );

          const reportGame: ExophaseSyncReportGame = {
            shop: game.shop,
            objectId: game.objectId,
            title: game.title,
            iconUrl: game.iconUrl ?? null,
            newlyUnlocked,
            totalUnlocked: unlocked.length,
            totalAchievements: definitions.length,
          };

          if (newlyUnlocked > 0) {
            totalNewlyUnlocked += newlyUnlocked;
            gamesUpdated++;
            reportGames.push(reportGame);
          }

          // 3. PSN detection — only probe games where the user looks to have
          //    earned little/nothing on PC (likely played on PlayStation).
          if (
            unlocked.length === 0 &&
            psnProbes < MAX_PSN_PROBES &&
            (prefs.exophaseManagedPlatforms?.length ?? 1) > 0
          ) {
            psnProbes++;
            const psnCandidates = await searchExophaseGames(
              fetcher,
              game.title,
              "psn"
            );
            const psnMatch = findBestMatch(game.title, psnCandidates, "psn");
            if (psnMatch) {
              psnDetected.push({ ...reportGame, psnDetected: true });
            }
          }
        } catch (err) {
          achievementsLogger.warn(
            `[Exophase bg] failed for "${game.title}"`,
            err
          );
        }
      }
    } finally {
      fetcher.close();
    }

    // 4. Share the refreshed cache.
    await pushSharedCache().catch(() => {});

    const report: ExophaseSyncReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      gamesProcessed: eligible.length,
      gamesUpdated,
      totalNewlyUnlocked,
      games: reportGames,
      psnDetected,
    };
    await db
      .put(levelKeys.exophaseSyncReport, report, { valueEncoding: "json" })
      .catch(() => {});

    WindowManager.sendToAppWindows("on-library-batch-complete");

    if (gamesUpdated > 0 || psnDetected.length > 0) {
      const parts: string[] = [];
      if (gamesUpdated > 0) {
        parts.push(
          `${totalNewlyUnlocked} new achievement${totalNewlyUnlocked !== 1 ? "s" : ""} across ${gamesUpdated} game${gamesUpdated !== 1 ? "s" : ""}`
        );
      }
      if (psnDetected.length > 0) {
        parts.push(
          `${psnDetected.length} PSN game${psnDetected.length !== 1 ? "s" : ""} detected`
        );
      }
      await LocalNotificationManager.createNotification(
        "ACHIEVEMENTS_SYNC_COMPLETE",
        "Achievements Sync finished",
        parts.join(" · "),
        { url: "/achievements-sync" }
      ).catch(() => {});
    }

    achievementsLogger.log(
      `[Exophase bg] complete: ${gamesUpdated} updated, ${totalNewlyUnlocked} new, ${psnDetected.length} PSN`
    );
  } finally {
    running = false;
  }
};
