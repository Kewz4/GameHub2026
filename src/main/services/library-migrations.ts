import {
  db,
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
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
 *      - custom-shop games                  → "custom"
 *      - platform URI exe (steam://run/…)   → "sync" (set by platform syncs)
 *      - real exe inside a store folder     → "sync"
 *      - real exe elsewhere (repack, scan)  → "custom" — installed-on-disk is
 *        NOT proof of store ownership; only platform syncs may claim "sync"
 *      - everything else unstamped          → "catalog"
 *    Platform sync loops keep re-stamping owned games with "sync" on every
 *    run, so a stamp here is never the final word for genuinely synced games.
 *
 * 3. One-time repair (libraryOriginRepairV2): earlier versions stamped "sync"
 *    on ANY game with ANY executable, which dumped repack installs and scan
 *    finds into the Steam tab. Demote those wrong stamps once; genuinely
 *    owned games are re-stamped "sync" by the next platform sync.
 */
export const runLibraryMigrations = async (): Promise<void> => {
  const entries: Array<[string, Game]> = await gamesSublevel
    .iterator()
    .all()
    .catch(() => []);

  // LoL dedup: steam:20590 is a defunct catalogue stub for League of Legends.
  // If riot:league_of_legends exists alongside it, delete the steam stub so it
  // doesn't appear as a second entry. Reviews from that stub are accessible via
  // the Riot LoL game-details page which shares the same Hydra API objectId.
  const riotLolKey = levelKeys.game("riot", "league_of_legends");
  const steamLolKey = levelKeys.game("steam", "20590");
  const [riotLol, steamLol] = await Promise.all([
    gamesSublevel.get(riotLolKey).catch(() => null),
    gamesSublevel.get(steamLolKey).catch(() => null),
  ]);
  if (riotLol && !riotLol.isDeleted && steamLol && !steamLol.isDeleted) {
    await gamesSublevel
      .put(steamLolKey, { ...steamLol, isDeleted: true })
      .catch(() => {});
    logger.info("[LibraryMigrations] Removed duplicate steam:20590 (LoL stub)");
  }

  const originRepairDone = await db
    .get<string, boolean>(levelKeys.libraryOriginRepairV2, {
      valueEncoding: "json",
    })
    .catch(() => false);

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
      const isUriExe = Boolean(exe?.includes("://"));
      let desired: "sync" | "catalog" | "custom" | null = null;

      if (game.shop === "custom") {
        if (game.libraryOrigin !== "custom") desired = "custom";
      } else if (!game.libraryOrigin) {
        // Only stamp high-confidence cases; leave genuinely ambiguous records
        // unstamped so the renderer's ownership-first getGameOrigin decides at
        // render time. This avoids locking in a wrong "catalog"/"custom" guess
        // for an owned game whose sync stamp was simply never written.
        if (isUriExe) {
          // Platform URI exes are only ever produced by a platform launcher.
          desired = "sync";
        } else {
          const dl = await downloadsSublevel.get(key).catch(() => null);
          // A GameHub download record is hard proof of a repack.
          if (dl) desired = "catalog";
          // Otherwise: no stamp, no URI exe, no repack download — leave it
          // unstamped; getGameOrigin treats platform-shop records as owned.
        }
      } else if (!originRepairDone && game.libraryOrigin === "sync") {
        // One-time repair of the old any-exe→"sync" stamp. The reliable signal
        // that a "sync"-stamped game is actually a GameHub repack (not a real
        // platform-owned title) is the presence of a GameHub download record —
        // NOT its install folder, since an owned game can be installed
        // anywhere. Only those are demoted to the catalogue; everything else
        // keeps "sync" so genuinely owned games never fall out of their tab.
        const download = await downloadsSublevel.get(key).catch(() => null);
        if (download) desired = "catalog";
      }

      const updates: Partial<typeof game> = {};
      if (desired && game.libraryOrigin !== desired) updates.libraryOrigin = desired;
      if (game.automaticCloudSync !== true) updates.automaticCloudSync = true;
      if (Object.keys(updates).length > 0) {
        await gamesSublevel.put(key, { ...game, ...updates });
      }
    } catch (err) {
      logger.error(`[LibraryMigrations] Failed migrating ${key}`, err);
    }
  }

  if (!originRepairDone) {
    await db
      .put(levelKeys.libraryOriginRepairV2, true, { valueEncoding: "json" })
      .catch(() => {});
  }

  logger.info("[LibraryMigrations] Library migration pass complete");
  // Notify the renderer so platform filters and library data reflect any stamps
  WindowManager.sendToAppWindows("on-library-batch-complete");
};
