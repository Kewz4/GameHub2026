import { registerEvent } from "../register-event";
import {
  exophaseCacheSublevel,
  gameAchievementsSublevel,
  gamesSublevel,
  gamesShopAssetsSublevel,
} from "@main/level";
import { idCacheKey } from "@main/services/achievements/exophase/exophase-cache";
import { HydraApi } from "@main/services/hydra-api";
import type { AchievementGameStat, GameShop, ShopAssets } from "@types";

const STEAM_CDN = "https://cdn.akamai.steamstatic.com/steam/apps";

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

    let assets: ShopAssets | null = await gamesShopAssetsSublevel.get(key).then((v) => v ?? null).catch(() => null);

    // key is `${shop}:${objectId}`
    const sep = key.indexOf(":");
    const keyShop = (sep >= 0 ? key.slice(0, sep) : key) as GameShop;
    const keyObjectId = sep >= 0 ? key.slice(sep + 1) : "";

    const shop = (game?.shop ?? keyShop) as GameShop;
    const objectId = game?.objectId ?? keyObjectId;

    // When the game has no cached assets, fetch and persist them so the icon
    // and title resolve correctly for non-library games (Exophase imports).
    if (!assets?.iconUrl && !game?.iconUrl) {
      if (shop === "steam" && objectId) {
        // Steam CDN URLs are deterministic — no API call needed.
        const base = `${STEAM_CDN}/${objectId}`;
        const exoEntry = await exophaseCacheSublevel
          .get(idCacheKey(shop, objectId))
          .catch(() => null);
        const title =
          game?.title ??
          exoEntry?.title ??
          assets?.title ??
          objectId;
        const freshAssets: ShopAssets = {
          shop,
          objectId,
          title,
          iconUrl: `${base}/library_600x900.jpg`,
          coverImageUrl: `${base}/library_600x900.jpg`,
          libraryImageUrl: `${base}/header.jpg`,
          libraryHeroImageUrl: `${base}/library_hero.jpg`,
          logoImageUrl: `${base}/logo.png`,
          logoPosition: null,
          downloadSources: assets?.downloadSources ?? [],
        };
        await gamesShopAssetsSublevel
          .put(key, { ...freshAssets, updatedAt: Date.now() })
          .catch(() => {});
        assets = freshAssets;
      } else if (objectId) {
        // Non-Steam: try the Hydra API catalogue endpoint (best-effort, no-auth).
        const fetched = await HydraApi.get<ShopAssets | null>(
          `/games/${shop}/${objectId}/assets`,
          null,
          { needsAuth: false }
        ).catch(() => null);
        if (fetched && (fetched.iconUrl || fetched.title)) {
          await gamesShopAssetsSublevel
            .put(key, { ...fetched, updatedAt: Date.now() })
            .catch(() => {});
          assets = fetched;
        }
      }
    }

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
        game?.customIconUrl || assets?.iconUrl || game?.iconUrl || null,
      achievementCount: total,
      unlockedAchievementCount,
      inLibrary: Boolean(game),
    });
  }

  return out;
};

registerEvent("getAchievementGames", getAchievementGames);
