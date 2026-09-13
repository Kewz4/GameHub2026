import type { CatalogueSearchResult } from "@types";

/**
 * A catalogue edge as the backend actually returns it — `searchVector` carries
 * the game's Steam tags as numeric ids and isn't in the shared API type.
 */
export type CatalogueRecommendationEdge = CatalogueSearchResult & {
  searchVector?: string | null;
};

/**
 * The Steam-tag recommender is a PC-catalogue pipeline. Console games have a
 * separate classics recommender and must never be title-searched against the
 * PC catalogue: a fuzzy Breath of the Wild search can legitimately return
 * theHunter: Call of the Wild near the top.
 */
export function selectPcRecommendationGames<T extends { shop: string }>(
  games: readonly T[]
): T[] {
  return games.filter((game) => game.shop !== "launchbox");
}

const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Catalogue search results are popularity ordered, not identity ordered.
 * Only an exact shop/object identity or exact normalized title is safe; never
 * borrow facets from the first fuzzy result.
 */
export function selectCatalogueRecommendationEdge(
  game: { shop: string; objectId: string; title: string },
  edges: readonly CatalogueRecommendationEdge[]
): CatalogueRecommendationEdge | null {
  const identityMatch = edges.find(
    (edge) => edge.objectId === game.objectId && edge.shop === game.shop
  );
  if (identityMatch) return identityMatch;

  const wantedTitle = normalizeTitle(game.title);
  if (!wantedTitle) return null;

  return (
    edges.find((edge) => normalizeTitle(edge.title) === wantedTitle) ?? null
  );
}
