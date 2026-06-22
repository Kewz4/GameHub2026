import { registerEvent } from "../register-event";
import {
  exophaseCacheSublevel,
  gameAchievementsSublevel,
  gamesSublevel,
  gamesShopAssetsSublevel,
} from "@main/level";
import { idCacheKey } from "@main/services/achievements/exophase/exophase-cache";
import type { AchievementGameStat, GameShop } from "@types";

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
    const defs = achievements?.achievements ?? [];
    const validNames = new Set(
      defs.map((a) => (a.name ?? "").toUpperCase())
    );

    // Count unlocked by unique valid apiName (mirrors get-library). No
    // unlockTime requirement — Exophase/PSN imports often lack timestamps.
    const unlockedNames = achievements?.unlockedAchievements
      ? new Set(
          achievements.unlockedAchievements
            .map((u) => (u.name ?? "").toUpperCase())
            .filter((name) => validNames.has(name))
        )
      : new Set<string>();

    const unlockedAchievementCount = unlockedNames.size;
    if (unlockedAchievementCount === 0) continue;

    const game = await gamesSublevel.get(key).catch(() => null);
    if (game?.isDeleted) continue;

    const assets = await gamesShopAssetsSublevel.get(key).catch(() => null);

    // key is `${shop}:${objectId}`
    const sep = key.indexOf(":");
    const keyShop = sep >= 0 ? key.slice(0, sep) : key;
    const keyObjectId = sep >= 0 ? key.slice(sep + 1) : "";

    // Fall back to the Exophase cache for title when the game is not in the
    // library and the shop-assets record has no title either.
    const exoEntry =
      !game?.title && !assets?.title
        ? await exophaseCacheSublevel
            .get(idCacheKey(keyShop as GameShop, keyObjectId))
            .catch(() => null)
        : null;

    // Total possible: best of the library record and the stored definitions, so
    // the denominator is never 0 when we have definitions.
    const total = Math.max(
      game?.achievementCount ?? 0,
      defs.length,
      unlockedAchievementCount
    );

    out.push({
      shop: (game?.shop ?? keyShop) as GameShop,
      objectId: game?.objectId ?? keyObjectId,
      title: game?.title ?? assets?.title ?? exoEntry?.title ?? keyObjectId,
      iconUrl:
        game?.customIconUrl || assets?.iconUrl || game?.iconUrl || null,
      achievementCount: total,
      unlockedAchievementCount,
      inLibrary: Boolean(game),
    });
  }

  return out;
};

registerEvent("getAchievementGames", getAchievementGames);
