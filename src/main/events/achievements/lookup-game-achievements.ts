import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services/window-manager";
import { achievementsLogger } from "@main/services/logger";
import { ExophaseFetcher } from "@main/services/achievements/exophase/exophase-web";
import {
  searchExophaseGames,
  findBestMatch,
  parseAchievements,
  awardsUrlFor,
} from "@main/services/achievements/exophase/exophase-api";
import { SHOP_TO_EXOPHASE_SLUG } from "@main/services/achievements/exophase/constants";
import { gamesSublevel, gameAchievementsSublevel } from "@main/level";
import type { GameShop } from "@types";

export interface LookupGameAchievementsResult {
  found: boolean;
  achievementsCount: number;
  error?: string;
}

const lookupGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<LookupGameAchievementsResult> => {
  const sendProgress = (message: string) => {
    WindowManager.sendToAppWindows("on-exophase-lookup-progress", {
      objectId,
      shop,
      message,
    });
  };

  try {
    const gameKey = `${shop}:${objectId}`;
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game) {
      return { found: false, achievementsCount: 0, error: "Game not in library" };
    }

    sendProgress(`Searching Exophase for "${game.title}"…`);
    achievementsLogger.log(`[Lookup] "${game.title}" (${shop}:${objectId})`);

    const slug = SHOP_TO_EXOPHASE_SLUG[shop as keyof typeof SHOP_TO_EXOPHASE_SLUG];
    const fetcher = new ExophaseFetcher();

    let candidates = await searchExophaseGames(fetcher, game.title, slug);
    achievementsLogger.log(`[Lookup] "${game.title}": ${candidates.length} Exophase results`);

    if (candidates.length === 0) {
      sendProgress(`No results for "${game.title}" on Exophase.`);
      return { found: false, achievementsCount: 0 };
    }

    const match = findBestMatch(game.title, candidates, slug);
    if (!match) {
      sendProgress(`Could not match "${game.title}" to an Exophase entry.`);
      achievementsLogger.log(`[Lookup] "${game.title}": no match found`);
      return { found: false, achievementsCount: 0 };
    }

    achievementsLogger.log(`[Lookup] "${game.title}" → "${match.title}" (${match.environment_slug})`);
    sendProgress(`Found "${match.title}" — fetching achievements…`);

    const awardsUrl = awardsUrlFor(match);
    const html = await fetcher.fetchHtml(awardsUrl);
    const achievements = parseAchievements(html);

    achievementsLogger.log(`[Lookup] "${game.title}": parsed ${achievements.length} achievements`);

    if (achievements.length === 0) {
      sendProgress(`No achievements found for "${game.title}".`);
      return { found: false, achievementsCount: 0 };
    }

    // Merge definitions into local store without overwriting unlock progress
    const existing = await gameAchievementsSublevel.get(gameKey).catch(() => null);
    const definitions = achievements.map((a) => ({
      name: a.apiName,
      displayName: a.displayName,
      description: a.description,
      icon: a.iconUrl,
      icongray: a.iconUrl,
      hidden: false,
      points: a.points ?? undefined,
    }));

    await gameAchievementsSublevel.put(gameKey, {
      achievements: definitions,
      unlockedAchievements: existing?.unlockedAchievements ?? [],
      updatedAt: Date.now(),
      language: existing?.language ?? "en",
      source: "exophase",
    });

    await gamesSublevel.put(gameKey, {
      ...game,
      achievementCount: achievements.length,
    });

    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${objectId}-${shop}`,
      existing?.unlockedAchievements ?? []
    );

    sendProgress(`Done! Found ${achievements.length} achievements for "${game.title}".`);
    achievementsLogger.log(`[Lookup] "${game.title}": stored ${achievements.length} definitions`);

    return { found: true, achievementsCount: achievements.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    achievementsLogger.error(`[Lookup] error for ${shop}:${objectId}:`, msg);
    sendProgress(`Error: ${msg}`);
    return { found: false, achievementsCount: 0, error: msg };
  }
};

registerEvent("lookupGameAchievements", lookupGameAchievements);
