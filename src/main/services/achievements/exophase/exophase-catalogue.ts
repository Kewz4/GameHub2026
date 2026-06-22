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

    // Partial match: only accept when the shorter normalized title is at least
    // 85% the length of the longer one. This prevents "god of war" (11 chars)
    // matching "god of war iii" (14 chars) — ratio 11/14 ≈ 0.79 < 0.85.
    const partial = edges.find((r) => {
      const rNorm = normalizeExophaseTitle(r.title);
      if (!rNorm || !norm) return false;
      const longer = Math.max(rNorm.length, norm.length);
      const shorter = Math.min(rNorm.length, norm.length);
      if (shorter / longer < 0.85) return false;
      return rNorm.includes(norm) || norm.includes(rNorm);
    });
    if (partial) {
      achievementsLogger.log(
        `[Catalogue] partial match: "${title}" → ${partial.shop}:${partial.objectId} ("${partial.title}")`
      );
      return partial;
    }

    // Prefix match: the query title is a prefix of the candidate (e.g. "Control"
    // matching "Control: Ultimate Edition", "Death Stranding" matching
    // "Death Stranding: Director's Cut"). Require at least 5 chars to avoid
    // false positives on very short titles.
    if (norm.length >= 5) {
      const prefix = edges.find((r) => {
        const rNorm = normalizeExophaseTitle(r.title);
        return rNorm.startsWith(norm + " ") || rNorm === norm;
      });
      if (prefix) {
        achievementsLogger.log(
          `[Catalogue] prefix match: "${title}" → ${prefix.shop}:${prefix.objectId} ("${prefix.title}")`
        );
        return prefix;
      }
    }

    achievementsLogger.log(`[Catalogue] no match for "${title}"`);
    return null;
  } catch (err) {
    achievementsLogger.warn(`[Catalogue] search failed for "${title}"`, err);
    return null;
  }
}
