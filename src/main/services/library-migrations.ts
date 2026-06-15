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
 * 3. One-time stamp repair (libraryOriginRepairV4): stamps unstamped games and
 *    corrects mis-stamped ones based on platform URI exe evidence — the only
 *    exe format that a platform sync handler (not a disk scan) ever writes.
 *    Also undoes the V3 over-demotion that wrongly marked sync games "custom".
 *    Rules: download record → "catalog"; platform URI exe → "sync";
 *    everything else → unchanged (platform sync re-stamps on next run).
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

  const originRepairV4Done = await db
    .get<string, boolean>(levelKeys.libraryOriginRepairV4, {
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
      // Platform URI exe schemes that ONLY a platform sync handler ever writes.
      // Real filesystem paths come from disk scans, user manual edits, or
      // Playnite imports — these are NOT proof of store ownership.
      const PLATFORM_URI_SCHEMES = [
        "steam://",
        "legendary://",
        "goggalaxy://",
        "goglauncher://",
        "msxbox://",
        "battlenet://",
        "origin2://",
        "uplay://",
        "riot://",
      ];
      const exe = game.executablePath?.toLowerCase() ?? "";
      const hasPlatformUri = PLATFORM_URI_SCHEMES.some((s) => exe.startsWith(s));
      let desired: "sync" | "catalog" | "custom" | null = null;

      if (game.shop === "custom") {
        if (game.libraryOrigin !== "custom") desired = "custom";
      } else {
        const dl = await downloadsSublevel.get(key).catch(() => null);
        if (dl) {
          // Repack/torrent download record always wins — it's a Retigga game.
          if (game.libraryOrigin !== "catalog") desired = "catalog";
        } else if (hasPlatformUri) {
          // A platform URI exe is 100% written by a platform sync handler
          // (sync-steam-library, sync-epic-library, etc.). Infer "sync" for
          // unstamped records AND undo any wrong V3 demotion to "custom".
          // We do NOT touch "catalog"-stamped games here: if Playnite stamped a
          // game "catalog" and the platform sync later set the URI exe but also
          // already updated the stamp to "sync", the stamp is already correct.
          // If somehow it's still "catalog" with a URI exe, the platform sync
          // is the stronger signal — promote it.
          if (game.libraryOrigin !== "sync") desired = "sync";
        }
        // Games with no URI exe, no download record:
        // - If already stamped "sync" → keep (trust the sync that set it)
        // - If "catalog" → keep (trust the explicit catalog stamp)
        // - If unstamped → leave unstamped; getGameOrigin sends to Retigga;
        //   the next platform sync run will promote genuine owned games to "sync"
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

  if (!originRepairV4Done) {
    await db
      .put(levelKeys.libraryOriginRepairV4, true, { valueEncoding: "json" })
      .catch(() => {});
  }

  logger.info("[LibraryMigrations] Library migration pass complete");
  // Notify the renderer so platform filters and library data reflect any stamps
  WindowManager.sendToAppWindows("on-library-batch-complete");
};
