import { HydraApi } from "@main/services";
import { achievementsLogger } from "@main/services/logger";
import type { GameShop } from "@types";
import { normalizeExophaseTitle } from "./exophase-api";

export interface CatalogueEntry {
  objectId: string;
  title: string;
  shop: GameShop;
}

/**
 * Search the Hydra API catalogue for a game by title. Returns the best-
 * matching entry or null. Used to verify that a PSN game found on Exophase
 * has a PC counterpart in the catalogue before we credit its trophies.
 */
export async function searchCatalogueForAchievements(
  title: string
): Promise<CatalogueEntry | null> {
  try {
    achievementsLogger.log(`[Catalogue] searching for "${title}"…`);
    const resp = await HydraApi.post<{
      edges: CatalogueEntry[];
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

    const norm = normalizeExophaseTitle(title);
    const edges = resp?.edges ?? [];

    const exact = edges.find((r) => normalizeExophaseTitle(r.title) === norm);
    if (exact) {
      achievementsLogger.log(
        `[Catalogue] exact match: "${title}" → ${exact.shop}:${exact.objectId} ("${exact.title}")`
      );
      return exact;
    }

    const partial = edges.find(
      (r) =>
        normalizeExophaseTitle(r.title).includes(norm) ||
        norm.includes(normalizeExophaseTitle(r.title))
    );
    if (partial) {
      achievementsLogger.log(
        `[Catalogue] partial match: "${title}" → ${partial.shop}:${partial.objectId} ("${partial.title}")`
      );
      return partial;
    }

    achievementsLogger.log(`[Catalogue] no match for "${title}"`);
    return null;
  } catch (err) {
    achievementsLogger.warn(`[Catalogue] search failed for "${title}"`, err);
    return null;
  }
}
