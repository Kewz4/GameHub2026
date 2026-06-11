import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import {
  compactGameTitle,
  normalizeGameTitle,
} from "@main/helpers/normalize-game-title";
import type { CatalogueSearchResult, Game } from "@types";

const searchCatalogue = async (
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
    return (
      resp?.edges?.find((r) => normalizeGameTitle(r.title) === titleNorm) ??
      resp?.edges?.find((r) => compactGameTitle(r.title) === titleCompact) ??
      null
    );
  } catch {
    return null;
  }
};

/**
 * One-shot library repairs that run shortly after startup.
 *
 * 1. Steam records whose objectId is a game TITLE instead of a numeric App ID
 *    (an old import bug — e.g. "Marvel's Spider-Man Remastered" instead of
 *    "1817070"). These break the game page, cloud saves and achievements.
 *    Repaired via a catalogue lookup and re-keyed in place.
 *
 * 2. libraryOrigin stamping for legacy records, so the per-platform library
 *    filters stop guessing:
 *      - custom-shop games               → "custom"
 *      - any executable (scheme or file) → "sync"   (installed = owned; this
 *        also re-stamps "catalog" games that a scan later found on disk)
 *      - everything else unstamped       → "catalog"
 *    Platform sync loops keep re-stamping owned games with "sync" on every
 *    run, so a stamp here is never the final word for genuinely synced games.
 */
export const runLibraryMigrations = async (): Promise<void> => {
  const entries: Array<[string, Game]> = await gamesSublevel
    .iterator()
    .all()
    .catch(() => []);

  for (const [key, game] of entries) {
    if (!game || game.isDeleted) continue;

    try {
      // --- Repair title-as-objectId Steam records -------------------------
      if (
        game.shop === "steam" &&
        game.objectId &&
        !/^\d+$/.test(game.objectId)
      ) {
        const lookupTitle = game.title ?? game.objectId;
        const match = await searchCatalogue(lookupTitle);
        if (match && /^\d+$/.test(match.objectId)) {
          const newKey = levelKeys.game(match.shop, match.objectId);
          const existing = await gamesSublevel.get(newKey).catch(() => null);

          if (!existing || existing.isDeleted) {
            await gamesSublevel.put(newKey, {
              ...game,
              objectId: match.objectId,
              shop: match.shop,
              title: game.title ?? match.title,
            });
            // Carry the shop assets over to the new key if present
            const assets = await gamesShopAssetsSublevel
              .get(key)
              .catch(() => null);
            if (assets) {
              await gamesShopAssetsSublevel
                .put(newKey, { ...assets, objectId: match.objectId })
                .catch(() => {});
            }
          }
          await gamesSublevel.del(key).catch(() => {});
          logger.info(
            `[LibraryMigrations] Repaired corrupted objectId "${game.objectId}" → ${match.objectId} (${lookupTitle})`
          );
          continue; // old key is gone; stamping applies to the new record next boot
        }
        // Catalogue unavailable or no match — leave for next launch
      }

      // --- Stamp libraryOrigin --------------------------------------------
      const exe = game.executablePath;
      let desired: "sync" | "catalog" | "custom" | null = null;

      if (game.shop === "custom") {
        if (game.libraryOrigin !== "custom") desired = "custom";
      } else if (exe) {
        // Any executable — a platform URI (steam://run/…) or a real file
        // found on disk by a scan — means the game is owned/installed,
        // not a catalogue-only entry.
        if (game.libraryOrigin !== "sync") desired = "sync";
      } else if (!game.libraryOrigin) {
        desired = "catalog";
      }

      if (desired && game.libraryOrigin !== desired) {
        await gamesSublevel.put(key, { ...game, libraryOrigin: desired });
      }
    } catch (err) {
      logger.error(`[LibraryMigrations] Failed migrating ${key}`, err);
    }
  }

  logger.info("[LibraryMigrations] Library migration pass complete");
};
