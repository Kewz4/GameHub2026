/**
 * Resolves the best available artwork/metadata for a game from three sources in order:
 *  1. Steam CDN     — for Steam games: deterministic, highest quality (600x900 cover, hero, logo)
 *  2. Hydra API     — if the game's shop+objectId is known to the API
 *  3. Hydra catalogue search — for non-Steam games, find the canonical entry by title
 *  4. SteamGridDB   — universal fallback for any game
 *
 * Returns a fully-populated partial ShopAssets object (all fields, no undefined).
 */

import type { GameShop, ShopAssets, CatalogueSearchResult } from "@types";
import { HydraApi } from "@main/services";
import { getSteamGridDbArtwork } from "@main/services/steamgriddb";
import { logger } from "@main/services";
import { normalizeGameTitle } from "./normalize-game-title";

export interface BestAssets {
  iconUrl: string | null;
  coverImageUrl: string | null;
  libraryImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  logoPosition: string | null;
  downloadSources: string[];
}

function shopAssetsToResult(assets: ShopAssets): BestAssets {
  return {
    iconUrl: assets.iconUrl ?? null,
    coverImageUrl: assets.coverImageUrl ?? null,
    libraryImageUrl: assets.libraryImageUrl ?? null,
    libraryHeroImageUrl: assets.libraryHeroImageUrl ?? null,
    logoImageUrl: assets.logoImageUrl ?? null,
    logoPosition: assets.logoPosition ?? null,
    downloadSources: assets.downloadSources ?? [],
  };
}

const STEAM_CDN = "https://cdn.akamai.steamstatic.com/steam/apps";

/**
 * Builds Steam CDN artwork URLs from an appId. These URLs are deterministic
 * and always serve full-resolution assets (600×900 portrait grid, hero banner,
 * transparent logo) — no API call needed, never stale.
 */
function buildSteamCdnAssets(objectId: string): BestAssets {
  const base = `${STEAM_CDN}/${objectId}`;
  return {
    iconUrl: `${base}/library_600x900.jpg`,
    coverImageUrl: `${base}/library_600x900.jpg`,
    libraryImageUrl: `${base}/header.jpg`,
    libraryHeroImageUrl: `${base}/library_hero.jpg`,
    logoImageUrl: `${base}/logo.png`,
    logoPosition: null,
    downloadSources: [],
  };
}

async function tryHydraAssets(
  shop: GameShop,
  objectId: string
): Promise<BestAssets | null> {
  try {
    const assets = await HydraApi.get<ShopAssets | null>(
      `/games/${shop}/${objectId}/assets`,
      null,
      { needsAuth: false }
    );
    // Only treat as a hit if at least one image field is populated
    if (
      assets &&
      (assets.coverImageUrl ||
        assets.iconUrl ||
        assets.libraryHeroImageUrl ||
        assets.libraryImageUrl)
    ) {
      return shopAssetsToResult(assets);
    }
  } catch {
    // not in API
  }
  return null;
}

async function tryHydraCatalogueByTitle(
  title: string
): Promise<BestAssets | null> {
  try {
    const resp = await HydraApi.post<{
      edges: CatalogueSearchResult[];
      count: number;
    }>(
      "/catalogue/search",
      {
        title,
        sortBy: "popularity",
        sortOrder: "desc",
        downloadSourceFingerprints: [],
        tags: [],
        publishers: [],
        genres: [],
        developers: [],
        protondbSupportBadges: [],
        deckCompatibility: [],
        take: 5,
        skip: 0,
      },
      { needsAuth: false }
    );
    const titleNorm = normalizeGameTitle(title);
    const match = resp?.edges?.find(
      (r) => normalizeGameTitle(r.title) === titleNorm
    );
    if (!match) return null;
    return tryHydraAssets(match.shop, match.objectId);
  } catch {
    return null;
  }
}

function sgdbToAssets(
  sgdb: Awaited<ReturnType<typeof getSteamGridDbArtwork>>,
  fallback: Partial<BestAssets> = {}
): BestAssets {
  return {
    iconUrl: sgdb?.gridUrl ?? fallback.iconUrl ?? null,
    coverImageUrl: sgdb?.gridUrl ?? fallback.coverImageUrl ?? null,
    libraryImageUrl: sgdb?.wideGridUrl ?? fallback.libraryImageUrl ?? null,
    libraryHeroImageUrl: sgdb?.heroUrl ?? fallback.libraryHeroImageUrl ?? null,
    logoImageUrl: sgdb?.logoUrl ?? fallback.logoImageUrl ?? null,
    logoPosition: fallback.logoPosition ?? null,
    downloadSources: fallback.downloadSources ?? [],
  };
}

/**
 * @param shop    The game's primary shop
 * @param objectId The game's objectId in that shop
 * @param title   Game title (used for catalogue search + SGDB)
 * @param initialFallback  Any artwork the caller already has (e.g. from the store API)
 */
/** Shops the Hydra API doesn't recognise (it only accepts steam/launchbox
 * style ids for these flows) AND whose titles are too generic for a reliable
 * catalogue title-search (e.g. "Legends of Runeterra" matched "Minecraft
 * Legends"). For these we go straight to SteamGridDB. */
const SGDB_ONLY_SHOPS: GameShop[] = ["riot"];

export async function fetchBestAssets(
  shop: GameShop,
  objectId: string,
  title: string,
  initialFallback: Partial<BestAssets> = {}
): Promise<BestAssets> {
  // Steam CDN is deterministic and always serves the highest-quality assets
  // (600×900 portrait cover, hero, logo). Use it first for all Steam games,
  // falling through to the Hydra API only for any missing fields.
  if (shop === "steam") {
    const cdnAssets = buildSteamCdnAssets(objectId);
    // The Hydra API may carry extras like downloadSources; merge those in.
    const hydraAssets = await tryHydraAssets(shop, objectId).catch(() => null);
    return {
      iconUrl: cdnAssets.iconUrl,
      coverImageUrl: cdnAssets.coverImageUrl,
      libraryImageUrl: cdnAssets.libraryImageUrl ?? hydraAssets?.libraryImageUrl ?? initialFallback.libraryImageUrl ?? null,
      libraryHeroImageUrl: cdnAssets.libraryHeroImageUrl,
      logoImageUrl: cdnAssets.logoImageUrl ?? hydraAssets?.logoImageUrl ?? initialFallback.logoImageUrl ?? null,
      logoPosition: hydraAssets?.logoPosition ?? initialFallback.logoPosition ?? null,
      downloadSources: hydraAssets?.downloadSources?.length
        ? hydraAssets.downloadSources
        : (initialFallback.downloadSources ?? []),
    };
  }

  if (SGDB_ONLY_SHOPS.includes(shop)) {
    try {
      const sgdb = await getSteamGridDbArtwork(title);
      if (sgdb) return sgdbToAssets(sgdb, initialFallback);
    } catch (err) {
      logger.warn(`fetchBestAssets: SGDB failed for "${title}"`, err);
    }
    return {
      iconUrl: initialFallback.iconUrl ?? null,
      coverImageUrl: initialFallback.coverImageUrl ?? null,
      libraryImageUrl: initialFallback.libraryImageUrl ?? null,
      libraryHeroImageUrl: initialFallback.libraryHeroImageUrl ?? null,
      logoImageUrl: initialFallback.logoImageUrl ?? null,
      logoPosition: initialFallback.logoPosition ?? null,
      downloadSources: initialFallback.downloadSources ?? [],
    };
  }

  // 1. Try Hydra API for this exact shop+objectId
  const hydraAssets = await tryHydraAssets(shop, objectId);
  if (hydraAssets) {
    // Merge: keep Hydra API values but fill any nulls from initialFallback
    return {
      iconUrl: hydraAssets.iconUrl ?? initialFallback.iconUrl ?? null,
      coverImageUrl:
        hydraAssets.coverImageUrl ?? initialFallback.coverImageUrl ?? null,
      libraryImageUrl:
        hydraAssets.libraryImageUrl ?? initialFallback.libraryImageUrl ?? null,
      libraryHeroImageUrl:
        hydraAssets.libraryHeroImageUrl ??
        initialFallback.libraryHeroImageUrl ??
        null,
      logoImageUrl:
        hydraAssets.logoImageUrl ?? initialFallback.logoImageUrl ?? null,
      logoPosition:
        hydraAssets.logoPosition ?? initialFallback.logoPosition ?? null,
      downloadSources: hydraAssets.downloadSources?.length
        ? hydraAssets.downloadSources
        : (initialFallback.downloadSources ?? []),
    };
  }

  // 2. Search the catalogue by title — may find the Steam entry with richer assets
  {
    const catalogueAssets = await tryHydraCatalogueByTitle(title);
    if (catalogueAssets) {
      return {
        iconUrl: catalogueAssets.iconUrl ?? initialFallback.iconUrl ?? null,
        coverImageUrl:
          catalogueAssets.coverImageUrl ??
          initialFallback.coverImageUrl ??
          null,
        libraryImageUrl:
          catalogueAssets.libraryImageUrl ??
          initialFallback.libraryImageUrl ??
          null,
        libraryHeroImageUrl:
          catalogueAssets.libraryHeroImageUrl ??
          initialFallback.libraryHeroImageUrl ??
          null,
        logoImageUrl:
          catalogueAssets.logoImageUrl ?? initialFallback.logoImageUrl ?? null,
        logoPosition:
          catalogueAssets.logoPosition ?? initialFallback.logoPosition ?? null,
        downloadSources: catalogueAssets.downloadSources?.length
          ? catalogueAssets.downloadSources
          : (initialFallback.downloadSources ?? []),
      };
    }
  }

  // 3. SGDB fallback — covers every field
  try {
    const sgdb = await getSteamGridDbArtwork(title);
    if (sgdb) return sgdbToAssets(sgdb, initialFallback);
  } catch (err) {
    logger.warn(`fetchBestAssets: SGDB failed for "${title}"`, err);
  }

  // Last resort: whatever the caller already had
  return {
    iconUrl: initialFallback.iconUrl ?? null,
    coverImageUrl: initialFallback.coverImageUrl ?? null,
    libraryImageUrl: initialFallback.libraryImageUrl ?? null,
    libraryHeroImageUrl: initialFallback.libraryHeroImageUrl ?? null,
    logoImageUrl: initialFallback.logoImageUrl ?? null,
    logoPosition: initialFallback.logoPosition ?? null,
    downloadSources: initialFallback.downloadSources ?? [],
  };
}
