import { UploadcareSync } from "@main/services/uploadcare-sync";
import { registerEvent } from "../register-event";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "@main/services";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import type { CatalogueSearchResult, UserPreferences } from "@types";

/** Resolve a game not present in the local library via the Hydra catalogue,
 * so cloud saves still show proper title/icon and navigate to a real page. */
/** Strip apostrophes/quotes for loose comparison */
const stripQuotes = (s: string) => s.replace(/[''`"]/g, "");

const resolveFromCatalogue = async (
  title: string
): Promise<CatalogueSearchResult | null> => {
  try {
    const resp = await HydraApi.post<{ edges: CatalogueSearchResult[] }>(
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
    const titleNormNoQuotes = stripQuotes(titleNorm);
    // Try strict normalize match first, then apostrophe-insensitive match
    return (
      resp?.edges?.find((r) => normalizeGameTitle(r.title) === titleNorm) ??
      resp?.edges?.find(
        (r) => stripQuotes(normalizeGameTitle(r.title)) === titleNormNoQuotes
      ) ??
      null
    );
  } catch {
    return null;
  }
};

const getAllArtifacts = async (_event: Electron.IpcMainInvokeEvent) => {
  const prefs = await db
    .get<
      string,
      UserPreferences
    >(levelKeys.userPreferences, { valueEncoding: "json" })
    .catch(() => ({}) as UserPreferences);

  const userId = prefs?.cloudSyncUserId ?? "anonymous";

  const artifacts = await UploadcareSync.listAllArtifacts(userId);

  // Cache catalogue lookups within this call — multiple artifacts often
  // belong to the same game
  const catalogueCache = new Map<string, CatalogueSearchResult | null>();

  // Enrich with game title and icon from local DB
  const enriched = await Promise.all(
    artifacts.map(async (artifact) => {
      let game = await gamesSublevel
        .get(levelKeys.game(artifact.shop, artifact.objectId))
        .catch(() => null);
      let resolvedShop = artifact.shop;
      let resolvedObjectId = artifact.objectId;
      let resolvedTitle: string | null = null;
      let resolvedIconUrl: string | null = null;

      // Legacy imports used the game title as objectId — search by title
      // (use apostrophe-insensitive comparison to handle curly vs straight quotes)
      if (!game) {
        const all = await gamesSublevel.iterator().all().catch(() => []);
        const objectIdNorm = stripQuotes(artifact.objectId?.toLowerCase() ?? "");
        const match = all.find(
          ([, g]) =>
            !g.isDeleted &&
            stripQuotes(g.title?.toLowerCase() ?? "") === objectIdNorm
        );
        if (match) {
          game = match[1];
          // Use the real shop/objectId from the DB so navigation works correctly
          resolvedShop = game.shop;
          resolvedObjectId = game.objectId;
        }
      }

      // Not in library at all — resolve via the Hydra catalogue so the entry
      // still gets metadata and navigates to a real game page.
      // Use gameName from metadata if available; fall back to objectId only if
      // it looks like a title (not a numeric Steam App ID).
      if (!game) {
        const searchTerm =
          artifact.gameName ??
          (/^\d+$/.test(artifact.objectId ?? "") ? null : artifact.objectId);
        if (searchTerm) {
          const cacheKey = searchTerm.toLowerCase();
          if (!catalogueCache.has(cacheKey)) {
            catalogueCache.set(cacheKey, await resolveFromCatalogue(searchTerm));
          }
          const catalogueMatch = catalogueCache.get(cacheKey);
          if (catalogueMatch) {
            resolvedShop = catalogueMatch.shop;
            resolvedObjectId = catalogueMatch.objectId;
            resolvedTitle = catalogueMatch.title;
            resolvedIconUrl =
              catalogueMatch.libraryImageUrl ??
              (catalogueMatch as Record<string, unknown>).iconUrl as string ?? null;
          }
        }
      }

      return {
        ...artifact,
        shop: resolvedShop,
        objectId: resolvedObjectId,
        gameTitle:
          game?.title ??
          resolvedTitle ??
          artifact.gameName ??
          artifact.objectId ??
          `${artifact.shop}:${artifact.objectId}`,
        gameIconUrl:
          game?.customIconUrl ?? game?.iconUrl ?? resolvedIconUrl ?? null,
      };
    })
  );

  return enriched;
};

registerEvent("getAllArtifacts", getAllArtifacts);
