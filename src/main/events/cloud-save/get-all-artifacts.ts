import { UploadcareSync } from "@main/services/uploadcare-sync";
import { registerEvent } from "../register-event";
import {
  db,
  gamesSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import { HydraApi, WindowManager } from "@main/services";
import {
  getCachedArtifacts,
  setCachedArtifacts,
} from "@main/services/cloud-artifacts-cache";
import {
  compactGameTitle,
  normalizeGameTitle,
} from "@main/helpers/normalize-game-title";
import type {
  CatalogueSearchResult,
  ShopAssets,
  UserPreferences,
} from "@types";

/** Resolve a game not present in the local library via the Hydra catalogue,
 * so cloud saves still show proper title/icon and navigate to a real page. */
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
    const titleCompact = compactGameTitle(title);
    // Strict normalize match first, then space/punctuation-insensitive match
    return (
      resp?.edges?.find((r) => normalizeGameTitle(r.title) === titleNorm) ??
      resp?.edges?.find((r) => compactGameTitle(r.title) === titleCompact) ??
      null
    );
  } catch {
    return null;
  }
};

const computeAllArtifacts = async () => {
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

      // Legacy imports used the game title as objectId — search by title.
      // Compact comparison handles spacing/punctuation variants ("NeonAbyss"
      // vs "Neon Abyss") and curly vs straight apostrophes alike. Also try
      // the gameName metadata field when present.
      if (!game) {
        const all = await gamesSublevel
          .iterator()
          .all()
          .catch(() => []);
        const candidates = [artifact.objectId, artifact.gameName]
          .filter((s): s is string => Boolean(s))
          .map((s) => compactGameTitle(s));
        const match = all.find(
          ([, g]) =>
            !g.isDeleted && candidates.includes(compactGameTitle(g.title ?? ""))
        );
        if (match) {
          game = match[1];
          resolvedShop = game.shop;
          // If the DB record's own objectId is non-numeric (the old bug that
          // stored the game title as objectId), repair it via a catalogue lookup
          // so navigation and future artifact matching use the correct numeric ID.
          if (game.shop === "steam" && !/^\d+$/.test(game.objectId)) {
            const cacheKey = `__repair__${(game.title ?? "").toLowerCase()}`;
            if (!catalogueCache.has(cacheKey)) {
              catalogueCache.set(
                cacheKey,
                await resolveFromCatalogue(game.title ?? "")
              );
            }
            const repaired = catalogueCache.get(cacheKey);
            if (repaired && repaired.objectId !== game.objectId) {
              const oldKey = levelKeys.game(game.shop, game.objectId);
              const newKey = levelKeys.game(repaired.shop, repaired.objectId);
              const existing = await gamesSublevel
                .get(newKey)
                .catch(() => null);
              if (!existing) {
                await gamesSublevel.put(newKey, {
                  ...game,
                  objectId: repaired.objectId,
                  shop: repaired.shop,
                });
              }
              await gamesSublevel.del(oldKey).catch(() => {});
              game = {
                ...game,
                objectId: repaired.objectId,
                shop: repaired.shop,
              };
              resolvedShop = repaired.shop;
              resolvedObjectId = repaired.objectId;
            } else {
              resolvedObjectId = game.objectId;
            }
          } else {
            resolvedObjectId = game.objectId;
          }
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
            catalogueCache.set(
              cacheKey,
              await resolveFromCatalogue(searchTerm)
            );
          }
          const catalogueMatch = catalogueCache.get(cacheKey);
          if (catalogueMatch) {
            resolvedShop = catalogueMatch.shop;
            resolvedObjectId = catalogueMatch.objectId;
            resolvedTitle = catalogueMatch.title;
            // Fetch real shop assets to get the proper small icon (not the wide
            // header libraryImageUrl that CatalogueSearchResult carries).
            const catalogueAssets = await HydraApi.get<ShopAssets | null>(
              `/games/${catalogueMatch.shop}/${catalogueMatch.objectId}/assets`,
              null,
              { needsAuth: false }
            ).catch(() => null);
            if (catalogueAssets) {
              await gamesShopAssetsSublevel
                .put(levelKeys.game(resolvedShop, resolvedObjectId), {
                  ...catalogueAssets,
                  updatedAt: Date.now(),
                })
                .catch(() => {});
            }
            resolvedIconUrl = catalogueAssets?.iconUrl ?? null;
          }
        }
      }

      const gameAssets = await gamesShopAssetsSublevel
        .get(levelKeys.game(resolvedShop, resolvedObjectId))
        .catch(() => null);

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
          game?.customIconUrl ??
          gameAssets?.iconUrl ??
          game?.iconUrl ??
          resolvedIconUrl ??
          null,
      };
    })
  );

  return { userId, enriched };
};

let refreshing = false;

/**
 * Stale-while-revalidate: serve the cached artifact list instantly (the R2
 * listing + per-artifact metadata + catalogue enrichment is slow), then
 * recompute in the background and push the fresh list to the renderer via
 * `on-cloud-artifacts-updated`.
 */
const getAllArtifacts = async (_event: Electron.IpcMainInvokeEvent) => {
  const cached = await getCachedArtifacts();

  if (cached) {
    if (!refreshing) {
      refreshing = true;
      computeAllArtifacts()
        .then(async ({ userId, enriched }) => {
          await setCachedArtifacts(userId, enriched);
          WindowManager.mainWindow?.webContents.send(
            "on-cloud-artifacts-updated",
            enriched
          );
        })
        .catch(() => {})
        .finally(() => {
          refreshing = false;
        });
    }
    return cached.artifacts;
  }

  const { userId, enriched } = await computeAllArtifacts();
  await setCachedArtifacts(userId, enriched);
  return enriched;
};

registerEvent("getAllArtifacts", getAllArtifacts);
