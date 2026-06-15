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
 * 2. libraryOrigin stamping for legacy records. Under the locked model
 *    (v4.6.4) we never INFER "sync" — only a platform login/OAuth sync handler
 *    may stamp it. Here we only stamp the unambiguous repack case
 *    (download record → "catalog"); all other unstamped records stay unstamped
 *    and resolve to Retigga at render time until a sync claims them.
 *
 * 3. One-time lock-down repair (libraryOriginRepairV3): earlier versions
 *    inferred "sync" from any platform-URI exe and from store-folder disk
 *    scans, which dumped repacks, Playnite imports and scanned installs into
 *    the platform tabs. Demote those once — repacks → "catalog", disk scans
 *    (real fs exe) → "custom" — so the platform tabs are left holding only
 *    genuine sync imports. Owned games are re-stamped "sync" by the next sync.
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

  const originRepairV3Done = await db
    .get<string, boolean>(levelKeys.libraryOriginRepairV3, {
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

      // --- Stamp / repair libraryOrigin -----------------------------------
      // Locked model (v4.6.4): platform tabs hold ONLY games stamped "sync" by
      // a platform login/OAuth sync handler. We NEVER infer "sync" here — not
      // from a URI exe, not from a store folder — because that inference is
      // exactly what leaked repacks/imports/scans into the platform tabs.
      const exe = game.executablePath;
      const isUriExe = Boolean(exe?.includes("://"));
      let desired: "sync" | "catalog" | "custom" | null = null;

      if (game.shop === "custom") {
        if (game.libraryOrigin !== "custom") desired = "custom";
      } else if (!game.libraryOrigin) {
        // Unstamped legacy record. Only the unambiguous repack case is stamped
        // here (download record → catalog); everything else stays unstamped and
        // getGameOrigin resolves it to Retigga at render time. A genuine
        // platform sync will stamp it "sync" on its next run.
        const dl = await downloadsSublevel.get(key).catch(() => null);
        if (dl) desired = "catalog";
      } else if (!originRepairV3Done && game.libraryOrigin === "sync") {
        // One-time lock-down repair: demote wrongly-"sync" games so the
        // platform tabs end up containing only genuine sync imports.
        //   • download record         → "catalog" (it's a repack)
        //   • real filesystem exe path → "custom"  (it was a disk scan, not a
        //     sync — every genuine sync writes either a platform URI exe, e.g.
        //     steam://run, legendary://run, or no exe at all, e.g. GOG)
        // Riot syncs store a real client path, so they're left untouched.
        const download = await downloadsSublevel.get(key).catch(() => null);
        if (download) {
          desired = "catalog";
        } else if (game.shop !== "riot" && exe && !isUriExe) {
          desired = "custom";
        }
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

  if (!originRepairV3Done) {
    await db
      .put(levelKeys.libraryOriginRepairV3, true, { valueEncoding: "json" })
      .catch(() => {});
  }

  logger.info("[LibraryMigrations] Library migration pass complete");
  // Notify the renderer so platform filters and library data reflect any stamps
  WindowManager.sendToAppWindows("on-library-batch-complete");
};
