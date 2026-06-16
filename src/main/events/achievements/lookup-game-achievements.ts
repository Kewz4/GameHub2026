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
      message: `Fetching achievements from ${url}…`,
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
