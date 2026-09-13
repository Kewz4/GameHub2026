import { registerEvent } from "../register-event";
import {
  exophaseCacheSublevel,
  gameAchievementsSublevel,
  gamesSublevel,
  gamesShopAssetsSublevel,
} from "@main/level";
import { idCacheKey } from "@main/services/achievements/exophase/exophase-cache";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import type { AchievementGameStat, GameShop } from "@types";
import {
  canonicalizeAchievementDefinitions,
  canonicalizeUnlockedAchievements,
} from "@main/services/achievements/achievement-sync-policy";

/**
 * Every game that has at least one unlocked achievement — sourced from the local
 * achievements store rather than the library, so games that were synced for
 * achievements but never added to the library (Exophase/PSN catalogue imports)
 * are included. Powers the profile achievement total + breakdown.
 */
const getAchievementGames = async (): Promise<AchievementGameStat[]> => {
  const entries = await gameAchievementsSublevel.iterator().all();
  const out: AchievementGameStat[] = [];

  for (const [key, achievements] of entries) {
    const defs = canonicalizeAchievementDefinitions(
      achievements?.achievements ?? []
    );

    // Count unlocked by unique valid apiName (mirrors get-library). No
    // unlockTime requirement — Exophase/PSN imports often lack timestamps.
    const unlockedNames = new Set(
      canonicalizeUnlockedAchievements(
        defs,
        achievements?.unlockedAchievements
      ).map((achievement) => achievement.name.toUpperCase())
    );

    const unlockedAchievementCount = unlockedNames.size;
    if (unlockedAchievementCount === 0) continue;

    const game = await gamesSublevel.get(key).catch(() => null);
    if (game?.isDeleted) continue;

    const assets = await gamesShopAssetsSublevel
      .get(key)
      .then((v) => v ?? null)
      .catch(() => null);

    // key is `${shop}:${objectId}`
    const sep = key.indexOf(":");
    const keyShop = (sep >= 0 ? key.slice(0, sep) : key) as GameShop;
    const keyObjectId = sep >= 0 ? key.slice(sep + 1) : "";

    const shop = (game?.shop ?? keyShop) as GameShop;
    const objectId = game?.objectId ?? keyObjectId;

    // Last-resort title fallback: Exophase cache entry title.
    const exoTitle =
      !game?.title && !assets?.title
        ? await exophaseCacheSublevel
            .get(idCacheKey(shop, objectId))
            .catch(() => null)
            .then((e) => e?.title ?? null)
        : null;

    // Total possible: best of the library record and the stored definitions, so
    // the denominator is never 0 when we have definitions.
    const total = Math.max(
      game?.achievementCount ?? 0,
      defs.length,
      unlockedAchievementCount
    );

    out.push({
      shop,
      objectId,
      title: game?.title ?? assets?.title ?? exoTitle ?? objectId,
      iconUrl:
        game?.customIconUrl ||
        assets?.iconUrl ||
        game?.iconUrl ||
        defs.find((definition) => definition.icon)?.icon ||
        null,
      achievementCount: total,
      unlockedAchievementCount,
      inLibrary: Boolean(game),
    });
  }

  // Deduplicate: the same game can be stored under multiple keys with DIFFERENT
  // objectIds — e.g. a Steam entry (steam:677120) and an Exophase/Xbox import of
  // the same game under another id. Dedup by normalized title so cross-platform
  // duplicates collapse into one row, keeping the entry with the most unlocks
  // (and, on a tie, the one that's actually in the library / has an icon).
  const best = new Map<string, AchievementGameStat>();
  for (const entry of out) {
    const dedupKey =
      normalizeGameTitle(entry.title) || `${entry.shop}:${entry.objectId}`;
    const prev = best.get(dedupKey);
    if (!prev) {
      best.set(dedupKey, entry);
      continue;
    }

    const entryIsBetter =
      entry.unlockedAchievementCount > prev.unlockedAchievementCount ||
      (entry.unlockedAchievementCount === prev.unlockedAchievementCount &&
        ((entry.inLibrary && !prev.inLibrary) ||
          (!prev.iconUrl && Boolean(entry.iconUrl))));

    if (entryIsBetter) {
      best.set(dedupKey, entry);
    }
  }
  return [...best.values()];
};

registerEvent("getAchievementGames", getAchievementGames);
