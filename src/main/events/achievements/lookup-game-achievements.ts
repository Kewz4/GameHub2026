import { registerEvent } from "../register-event";
import { gameAchievementsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { achievementsLogger } from "@main/services/logger";
import {
  SHOP_TO_EXOPHASE_SLUG,
  ExophaseFetcher,
  searchExophaseGames,
  findBestMatch,
  awardsUrlFor,
  parseAchievements,
  toDefinitions,
  toUnlockedList,
  lookupCacheEntry,
  applyCachedAchievements,
} from "@main/services/achievements/exophase";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop } from "@types";

interface LookupResult {
  found: boolean;
  achievementCount: number;
  unlockedCount: number;
  awardsUrl?: string;
  error?: string;
}

const lookupGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<LookupResult> => {
  const gameKey = levelKeys.game(shop, objectId);
  achievementsLogger.log(`[Exophase lookup] starting for ${shop}:${objectId}`);

  const game = await gamesSublevel.get(gameKey).catch(() => null);
  if (!game) {
    achievementsLogger.warn(`[Exophase lookup] game not found: ${gameKey}`);
    return { found: false, achievementCount: 0, unlockedCount: 0, error: "Game not found in library." };
  }

  WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
    status: "searching",
    message: `Looking up achievements for "${game.title}"…`,
  });

  // Cache-first: if the account sync already resolved this game, apply it directly.
  const cached = await lookupCacheEntry(game);
  if (cached && cached.definitions.length > 0) {
    achievementsLogger.log(
      `[Exophase lookup] cache hit for "${game.title}": ${cached.definitions.length} defs, ${cached.unlocked?.length ?? 0} unlocked`
    );
    await applyCachedAchievements(gameKey, game);
    WindowManager.sendToAppWindows("on-library-batch-complete");

    const unlockedCount = cached.unlocked?.length ?? 0;
    WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
      status: "done",
      message: `Found ${cached.definitions.length} achievements (${unlockedCount} unlocked) from cache.`,
    });
    return {
      found: true,
      achievementCount: cached.definitions.length,
      unlockedCount,
      awardsUrl: cached.awardsUrl ?? undefined,
    };
  }

  // Cache miss — do a live Exophase search for this game's platform.
  const slug = SHOP_TO_EXOPHASE_SLUG[shop];
  if (!slug) {
    achievementsLogger.warn(`[Exophase lookup] no Exophase slug for shop "${shop}"`);
    return { found: false, achievementCount: 0, unlockedCount: 0, error: `No Exophase support for shop "${shop}".` };
  }

  achievementsLogger.log(`[Exophase lookup] searching "${game.title}" on "${slug}"`);
  const fetcher = new ExophaseFetcher();
  try {
    WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
      status: "searching",
      message: `Searching Exophase for "${game.title}"…`,
    });

    const candidates = await searchExophaseGames(fetcher, game.title, slug);
    achievementsLogger.log(`[Exophase lookup] "${game.title}" → ${candidates.length} candidates`);

    const match = findBestMatch(game.title, candidates, slug);
    if (!match) {
      achievementsLogger.log(`[Exophase lookup] no match for "${game.title}" on "${slug}"`);
      WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
        status: "not_found",
        message: `No Exophase entry found for "${game.title}" on ${slug}.`,
      });
      return { found: false, achievementCount: 0, unlockedCount: 0, error: `Not found on Exophase for platform ${slug}.` };
    }

    const url = awardsUrlFor(match);
    achievementsLogger.log(`[Exophase lookup] match: "${match.title}" → ${url}`);

    WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
      status: "fetching",
      message: `Fetching achievements from Exophase…`,
    });

    const html = await fetcher.fetchHtml(url);
    const achievements = parseAchievements(html);
    achievementsLogger.log(
      `[Exophase lookup] "${game.title}": ${achievements.length} achievements, ${achievements.filter(a => a.unlocked).length} unlocked`
    );

    if (achievements.length > 0) {
      const definitions = toDefinitions(achievements);
      const unlocked = toUnlockedList(achievements);

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
        `on-update-achievements-${objectId}-${shop}`,
        unlocked
      );
      WindowManager.sendToAppWindows("on-library-batch-complete");

      WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
        status: "done",
        message: `Found ${achievements.length} achievements (${unlocked.length} unlocked).`,
      });
    }

    return {
      found: achievements.length > 0,
      achievementCount: achievements.length,
      unlockedCount: achievements.filter((a) => a.unlocked).length,
      awardsUrl: url,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    achievementsLogger.warn(`[Exophase lookup] failed for "${game.title}"`, err);
    return { found: false, achievementCount: 0, unlockedCount: 0, error: msg };
  } finally {
    fetcher.close();
  }
};

registerEvent("lookupGameAchievements", lookupGameAchievements);
