import { registerEvent } from "../register-event";
import {
  exophaseCacheSublevel,
  gameAchievementsSublevel,
  gamesSublevel,
  gamesShopAssetsSublevel,
} from "@main/level";
import { idCacheKey } from "@main/services/achievements/exophase/exophase-cache";
import { HydraApi } from "@main/services/hydra-api";
import { getSteamGridDbArtwork } from "@main/services/steamgriddb";
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

    let assets: ShopAssets | null = await gamesShopAssetsSublevel
      .get(key)
      .then((v) => v ?? null)
      .catch(() => null);

    // key is `${shop}:${objectId}`
    const sep = key.indexOf(":");
    const keyShop = (sep >= 0 ? key.slice(0, sep) : key) as GameShop;
    const keyObjectId = sep >= 0 ? key.slice(sep + 1) : "";

    const shop = (game?.shop ?? keyShop) as GameShop;
    const objectId = game?.objectId ?? keyObjectId;

    // When the game has no cached assets (or has no iconUrl), fetch them from
    // the HydraAPI — this returns the real small icon, not the cover art.
    // Steam CDN URLs are only used as fallback for non-icon image fields.
    if (!assets?.iconUrl && !game?.iconUrl && objectId) {
      const apiAssets = await HydraApi.get<ShopAssets | null>(
        `/games/${shop}/${objectId}/assets`,
        null,
        { needsAuth: false }
      ).catch(() => null);

      if (apiAssets?.iconUrl) {
        // API returned a real icon — merge with any CDN fallback fields for Steam.
        const base = shop === "steam" ? `${STEAM_CDN}/${objectId}` : null;
        const merged: ShopAssets = {
          shop,
          objectId,
          title: game?.title ?? apiAssets.title ?? assets?.title ?? objectId,
          iconUrl: apiAssets.iconUrl,
          coverImageUrl:
            apiAssets.coverImageUrl ??
            (base ? `${base}/library_600x900.jpg` : null),
          libraryImageUrl:
            apiAssets.libraryImageUrl ??
            (base ? `${base}/header.jpg` : null),
          libraryHeroImageUrl:
            apiAssets.libraryHeroImageUrl ??
            (base ? `${base}/library_hero.jpg` : null),
          logoImageUrl:
            apiAssets.logoImageUrl ?? (base ? `${base}/logo.png` : null),
          logoPosition: apiAssets.logoPosition ?? null,
          downloadSources:
            apiAssets.downloadSources ?? assets?.downloadSources ?? [],
        };
        await gamesShopAssetsSublevel
          .put(key, { ...merged, updatedAt: Date.now() })
          .catch(() => {});
        assets = merged;
      } else if (shop === "steam") {
        // HydraAPI had no iconUrl — generate Steam CDN URLs for other fields
        // but use SteamGridDB for the icon (same path as fetchBestAssets).
        const base = `${STEAM_CDN}/${objectId}`;
        const exoEntry = await exophaseCacheSublevel
          .get(idCacheKey(shop, objectId))
          .catch(() => null);
        const title =
          game?.title ??
          exoEntry?.title ??
          apiAssets?.title ??
          assets?.title ??
          objectId;

        const sgdb = await getSteamGridDbArtwork(title).catch(() => null);

        const freshAssets: ShopAssets = {
          shop,
          objectId,
          title,
          iconUrl: sgdb?.gridUrl ?? `${base}/capsule_sm_120.jpg`,
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
