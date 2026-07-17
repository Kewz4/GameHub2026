import { useEffect, useState } from "react";
import { orderBy } from "lodash-es";

import type {
  CatalogueSearchResult,
  DownloadSource,
  ShopAssets,
  TrendingGame,
} from "@types";
import { CatalogueCategory } from "@shared";
import { levelDBService } from "@renderer/services/leveldb.service";
import { buildGameDetailsPath, ensureArray } from "@renderer/helpers";

export interface HomeCatalogue {
  featured: TrendingGame[];
  hot: ShopAssets[];
  weekly: ShopAssets[];
  achievements: ShopAssets[];
  classics: ShopAssets[];
}

const EMPTY_CATALOGUE: HomeCatalogue = {
  featured: [],
  hot: [],
  weekly: [],
  achievements: [],
  classics: [],
};

/**
 * The classics browse endpoint returns `CatalogueSearchResult`, which only
 * carries a subset of `ShopAssets`. We widen it to `ShopAssets` (filling the
 * missing artwork slots with `null`) so the same `<GameCard>` used by every
 * other row can render it without a bespoke card.
 */
const classicsResultToShopAssets = (
  result: CatalogueSearchResult
): ShopAssets => ({
  objectId: result.objectId,
  shop: result.shop,
  title: result.title,
  iconUrl: null,
  libraryHeroImageUrl: null,
  libraryImageUrl: result.libraryImageUrl ?? null,
  logoImageUrl: null,
  logoPosition: null,
  coverImageUrl: null,
  downloadSources: result.downloadSources ?? [],
});

async function getCategory(
  category: CatalogueCategory,
  downloadSourceIds: string[]
): Promise<ShopAssets[]> {
  const response = await window.electron.hydraApi.get<ShopAssets[]>(
    `/catalogue/${category}`,
    {
      params: { take: 24, skip: 0, downloadSourceIds },
      needsAuth: false,
    }
  );

  return ensureArray<ShopAssets>(response, `/catalogue/${category}`);
}

async function getFeatured(language: string): Promise<TrendingGame[]> {
  const response = await window.electron.hydraApi.get<TrendingGame[]>(
    "/catalogue/featured",
    {
      params: { language },
      needsAuth: false,
    }
  );

  return ensureArray<TrendingGame>(response, "/catalogue/featured");
}

/**
 * Derive hero slides from an already-fetched category (Hot/Weekly) when
 * `/catalogue/featured` comes back empty — which it has done repeatedly on this
 * fork's backend. We keep only games that actually carry the two artwork slots
 * the hero renders (`libraryHeroImageUrl` + `logoImageUrl`) so slides are never
 * blank, and synthesize the `uri` the carousel navigates to.
 */
function heroFallbackFrom(games: ShopAssets[]): TrendingGame[] {
  return games
    .filter((g) => g.libraryHeroImageUrl && g.logoImageUrl)
    .slice(0, 5)
    .map((g) => ({
      ...g,
      description: null,
      uri: buildGameDetailsPath({
        shop: g.shop,
        objectId: g.objectId,
        title: g.title,
      }),
    }));
}

async function getClassics(): Promise<ShopAssets[]> {
  // Randomized, mixed-platform, artwork-only console games — a fresh shuffle
  // each load. The row hides itself when this is empty (see category-row).
  const response = await window.electron.getRandomClassics(24);

  return ensureArray<CatalogueSearchResult>(response, "getRandomClassics").map(
    classicsResultToShopAssets
  );
}

/**
 * Single source of truth for the home screen. Every list is fetched exactly
 * once (in parallel) so the hero carousel and the category rows never request
 * the same dataset twice. The hero consumes `/catalogue/featured`, which is a
 * distinct dataset from `/catalogue/hot`, so the hero and the Hot row do not
 * overlap.
 */
export function useHomeCatalogue(language: string) {
  const [catalogue, setCatalogue] = useState<HomeCatalogue>(EMPTY_CATALOGUE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadCatalogue() {
      setIsLoading(true);

      const sources = (await levelDBService.values(
        "downloadSources"
      )) as DownloadSource[];
      const downloadSourceIds = orderBy(sources, "createdAt", "desc").map(
        (source) => source.id
      );

      const [featured, hot, weekly, achievements, classics] = await Promise.all(
        [
          getFeatured(language).catch(() => [] as TrendingGame[]),
          getCategory(CatalogueCategory.Hot, downloadSourceIds).catch(
            () => [] as ShopAssets[]
          ),
          getCategory(CatalogueCategory.Weekly, downloadSourceIds).catch(
            () => [] as ShopAssets[]
          ),
          getCategory(CatalogueCategory.Achievements, downloadSourceIds).catch(
            () => [] as ShopAssets[]
          ),
          getClassics().catch(() => [] as ShopAssets[]),
        ]
      );

      // Keep the hero alive even when `/catalogue/featured` returns empty by
      // seeding it from the Hot (then Weekly) row, which shares the same
      // artwork fields the hero needs.
      const resolvedFeatured = featured.length
        ? featured
        : heroFallbackFrom(hot.length ? hot : weekly);

      if (isMounted) {
        setCatalogue({
          featured: resolvedFeatured,
          hot,
          weekly,
          achievements,
          classics,
        });
      }
    }

    loadCatalogue()
      .catch(() => {
        if (isMounted) setCatalogue(EMPTY_CATALOGUE);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [language]);

  return { catalogue, isLoading };
}
