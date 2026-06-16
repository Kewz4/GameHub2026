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
import { searchCatalogueForAchievements } from "./exophase-catalogue";
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
 * PlayStation trophy import — profile-based.
 *
 * Correct approach: look at which PSN trophies the user has ACTUALLY EARNED
 * on Exophase (not which games are in the local library), then find the PC
 * equivalent via Hydra API catalogue and credit matching trophies.
 *
 * This correctly handles games like Immortals Fenyx Rising: the user played it
 * on PS4, Playnite imported it as a "steam" library game, but the current sync
 * couldn't find Steam achievements because they never played it on PC. Now we
 * detect that they have PSN trophies and credit the PC version.
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
        // 1. Find this game's PSN entry on Exophase.
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

        const psnUrl = awardsUrlFor(psnMatch);
        achievementsLogger.log(
          `[Exophase] PSN matched "${psnMatch.title}" env="${psnMatch.environment_slug}" url="${psnUrl}"`
        );

        // 2. Fetch the user's earned PSN trophies for this entry.
        const psnTrophies = parseAchievements(await fetcher.fetchHtml(psnUrl));
        const earnedTrophies = psnTrophies.filter((t) => t.unlocked);
        achievementsLogger.log(
          `[Exophase] PSN "${game.title}": ${psnTrophies.length} trophies total, ${earnedTrophies.length} earned`
        );

        if (earnedTrophies.length === 0) {
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": user has no earned PSN trophies — skipping`
          );
          continue;
        }

        const earnedNames = new Set(
          earnedTrophies.map((t) => normalizeAchievementName(t.displayName))
        );

        // 3. Resolve the canonical PC game via the Hydra catalogue.
        //
        // We deliberately do NOT trust game.shop here. Playnite imports PS4
        // titles under a fake "steam"/"gog" shop, so the library shop is an
        // unreliable signal for the real PC platform (e.g. Immortals Fenyx
        // Rising is Epic/Ubisoft on PC, never Steam). The Hydra catalogue is the
        // authoritative source for the PC platform. We always credit trophies
        // onto the library game the user actually sees (`key`/`game`).
        const pcGameKey = key;
        const pcGame: Game = game;

        achievementsLogger.log(
          `[Exophase] PSN "${game.title}": searching Hydra catalogue for PC match…`
        );
        const catalogueMatch = await searchCatalogueForAchievements(game.title);

        // Candidate Exophase PC slugs, in priority order: the catalogue's real
        // platform first, then the library shop as a fallback.
        const pcSlugCandidates: string[] = [];
        if (catalogueMatch) {
          const cslug = SHOP_TO_EXOPHASE_SLUG[catalogueMatch.shop];
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": catalogue → ${catalogueMatch.shop}:${catalogueMatch.objectId} "${catalogueMatch.title}" (slug=${cslug ?? "none"})`
          );
          if (cslug) pcSlugCandidates.push(cslug);
        } else {
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": no Hydra catalogue match`
          );
        }
        const librarySlug = SHOP_TO_EXOPHASE_SLUG[game.shop];
        if (librarySlug && !pcSlugCandidates.includes(librarySlug)) {
          pcSlugCandidates.push(librarySlug);
        }

        const pcTitle = catalogueMatch?.title ?? game.title;

        // 4. Try each candidate PC platform on Exophase until one yields
        // achievement definitions.
        let pcAchievements: ExophaseAchievement[] = [];
        let pcSlugUsed: string | null = null;
        for (const slug of pcSlugCandidates) {
          const pcCandidates = await searchExophaseGames(fetcher, pcTitle, slug);
          const pcMatch = findBestMatch(pcTitle, pcCandidates, slug);
          achievementsLogger.log(
            `[Exophase] PSN "${pcTitle}" PC try slug="${slug}": ${pcCandidates.length} candidates, match=${pcMatch?.title ?? "none"}`
          );
          if (!pcMatch) continue;
          const pcUrl = awardsUrlFor(pcMatch);
          const parsed = parseAchievements(await fetcher.fetchHtml(pcUrl));
          if (parsed.length > 0) {
            achievementsLogger.log(
              `[Exophase] PSN "${pcTitle}": ${parsed.length} PC achievements from slug="${slug}"`
            );
            pcAchievements = parsed;
            pcSlugUsed = slug;
            break;
          }
        }

        // 5. Decide what to persist.
        //   a) PC definitions found → credit PC achievements matching earned
        //      PSN trophy names (cross-platform carry-over), preserving any the
        //      user already unlocked on PC.
        //   b) No PC definitions (PS4-only title, or no PC Exophase page) →
        //      credit the PSN trophy set DIRECTLY so the trophies still show up.
        //      This is the key fix: these games were previously silently
        //      skipped (e.g. Immortals Fenyx Rising, Fall Guys).
        const existing = await gameAchievementsSublevel
          .get(pcGameKey)
          .catch(() => null);

        let definitions: SteamAchievement[];
        let credited: UnlockedAchievement[];

        if (pcAchievements.length > 0) {
          const psnCredited: UnlockedAchievement[] = pcAchievements
            .filter((a) =>
              earnedNames.has(normalizeAchievementName(a.displayName))
            )
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

          // If the PC page exists but NONE of its names match the earned PSN
          // trophies, the PC definitions are useless for showing the user's PS4
          // progress — fall back to the PSN trophy set instead.
          if (psnCredited.length === 0) {
            achievementsLogger.log(
              `[Exophase] PSN "${pcTitle}": PC page (slug=${pcSlugUsed}) had no name matches — falling back to PSN trophies`
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
            `[Exophase] PSN "${game.title}": no PC achievements found — crediting ${psnTrophies.length} PSN trophy definitions directly`
          );
          definitions = toDefinitions(psnTrophies);
          credited = mergeUnlocked(
            existing?.unlockedAchievements ?? [],
            toUnlockedList(psnTrophies)
          );
        }

        if (credited.length === 0) {
          achievementsLogger.log(
            `[Exophase] PSN "${game.title}": nothing to credit — skipping`
          );
          continue;
        }

        await persistGameAchievements(pcGameKey, pcGame, definitions, credited);

        // 6. Infer playtime from PSN trophy unlock span when the game has none.
        const currentPlaytime = pcGame.playTimeInMilliseconds ?? 0;
        if (currentPlaytime === 0 && earnedTrophies.length >= 2) {
          const timestamps = earnedTrophies
            .map((t) => t.unlockTime)
            .filter((t): t is number => t !== null && t > 0)
            .sort((a, b) => a - b);
          if (timestamps.length >= 2) {
            const inferredMs =
              timestamps[timestamps.length - 1] - timestamps[0];
            achievementsLogger.log(
              `[Exophase] PSN "${pcGame.title}": inferring ${Math.round(inferredMs / 60000)} min playtime from trophy span`
            );
            await gamesSublevel.put(pcGameKey, {
              ...pcGame,
              playTimeInMilliseconds: inferredMs,
              achievementCount: definitions.length,
              unlockedAchievementCount: credited.length,
            });
          }
        }

        result.gamesMatched++;
        result.totalUnlocked += credited.length;
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
