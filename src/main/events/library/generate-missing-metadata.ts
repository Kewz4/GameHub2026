import { registerEvent } from "../register-event";
import {
  gamesSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
  getGameHubMeta,
} from "@main/level";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { logger, WindowManager } from "@main/services";
import { systemFromObjectId, platformToSystem } from "@main/helpers";
import { probeArtworkUrl } from "@main/services/artwork-url-probe";

export interface MetadataGameResult {
  title: string;
  coverUrl: string | null;
  what: string;
  status: "updated" | "failed";
}

/** Library cards are 3:4 portrait — a cover sourced from a known-landscape
 * asset (Steam headers/capsules, GOG logos, wide grids) gets stretched and
 * looks blurry. Treat those as wrong and re-fetch a proper portrait cover. */
const LANDSCAPE_URL_HINTS = [
  "header.jpg", // Steam store header (460x215)
  "capsule_616x353",
  "capsule_231x87",
  "460x215", // SteamGridDB wide grid dimensions
  "logo2x", // GOG logo asset
  "_glx_logo", // GOG logo asset (alternate naming)
];

const isLandscapeCoverUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  const lower = url.toLowerCase();
  return LANDSCAPE_URL_HINTS.some((hint) => lower.includes(hint));
};

/**
 * A stored cover can be a non-null URL that 404s (store CDNs rotate/expire
 * assets) — the card then shows the broken-image placeholder and the presence
 * check above would skip it forever. HEAD-check the URL: 2xx/3xx = alive,
 * confirmed 4xx = dead (re-fetch). Network errors and transient 5xx responses
 * remain unknown so an offline/outage run never wipes persisted artwork.
 */
const generateMissingMetadata = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  results: MetadataGameResult[];
}> => {
  const allGames = await gamesSublevel.values().all();
  const games = allGames.filter((g) => !g.isDeleted);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const total = games.length;
  let current = 0;
  const results: MetadataGameResult[] = [];

  WindowManager.sendToAppWindows("on-metadata-progress", {
    current,
    total,
    title: null,
  });

  let nextGameIndex = 0;
  const processGames = async () => {
    while (nextGameIndex < games.length) {
      const game = games[nextGameIndex++];
      current++;
      WindowManager.sendToAppWindows("on-metadata-progress", {
        current,
        total,
        title: game.title,
      });
      const cacheKey = levelKeys.game(game.shop, game.objectId);
      const assets = await gamesShopAssetsSublevel
        .get(cacheKey)
        .catch(() => null);

      // Console/emulated games (shop === "launchbox"): their full artwork lives
      // in the bundled gamehub-meta dataset (cover + hero + logo + icon). Import
      // only writes a cover via a live SGDB lookup, so hero/logo are usually
      // missing — which left the game-details page bare and made this button a
      // no-op (it skipped anything that already had a cover). Merge the dataset's
      // richer art in directly; it's the authoritative source and needs no
      // network call.
      if (game.shop === "launchbox") {
        const system =
          systemFromObjectId(game.objectId) ?? platformToSystem(game.platform);
        const meta = system
          ? await getGameHubMeta(system, game.title).catch(() => null)
          : null;

        if (meta) {
          const merged = {
            coverImageUrl: assets?.coverImageUrl ?? meta.coverImageUrl ?? null,
            libraryImageUrl:
              assets?.libraryImageUrl ?? meta.libraryImageUrl ?? null,
            libraryHeroImageUrl:
              assets?.libraryHeroImageUrl ?? meta.libraryHeroImageUrl ?? null,
            logoImageUrl: assets?.logoImageUrl ?? meta.logoImageUrl ?? null,
            iconUrl: assets?.iconUrl ?? meta.iconUrl ?? null,
          };
          const filledSomething =
            merged.coverImageUrl !== (assets?.coverImageUrl ?? null) ||
            merged.libraryHeroImageUrl !==
              (assets?.libraryHeroImageUrl ?? null) ||
            merged.logoImageUrl !== (assets?.logoImageUrl ?? null) ||
            merged.libraryImageUrl !== (assets?.libraryImageUrl ?? null) ||
            merged.iconUrl !== (assets?.iconUrl ?? null);

          if (filledSomething) {
            await gamesShopAssetsSublevel.put(cacheKey, {
              ...(assets ?? {}),
              objectId: game.objectId,
              shop: game.shop,
              title: game.title,
              ...merged,
              logoPosition: assets?.logoPosition ?? null,
              downloadSources: assets?.downloadSources ?? [],
              updatedAt: Date.now(),
            });
            const found: string[] = [];
            if (merged.coverImageUrl) found.push("cover");
            if (merged.libraryHeroImageUrl) found.push("hero image");
            if (merged.logoImageUrl) found.push("logo");
            results.push({
              title: game.title,
              coverUrl:
                merged.coverImageUrl ?? merged.libraryHeroImageUrl ?? null,
              what: found.length ? `Found: ${found.join(", ")}` : "Updated art",
              status: "updated",
            });
            updated++;
          } else {
            skipped++;
          }
          continue;
        }
        // No dataset entry — fall through to the generic SGDB/catalogue path.
      }

      // A landscape image stored as the portrait cover is as bad as no cover —
      // re-fetch so the card gets a proper 600x900 grid
      const coverIsWrongRatio = isLandscapeCoverUrl(assets?.coverImageUrl);

      // Very old syncs stored Steam's small square community icon as the cover.
      // Accept verified SGDB/store portraits; only this known-square source is
      // intrinsically invalid.
      const isSteamSquareIcon =
        game.shop === "steam" &&
        assets?.coverImageUrl != null &&
        /steamcommunity\/public\/images\/apps/i.test(assets.coverImageUrl);

      // A stored cover URL that 404s counts as missing — otherwise the game is
      // skipped forever while its card shows the broken-image placeholder.
      const coverIsDead =
        Boolean(assets?.coverImageUrl) &&
        !coverIsWrongRatio &&
        (await probeArtworkUrl(assets!.coverImageUrl!)) === "missing";

      // Only skip if we have an actual cover or hero image — icon alone is not sufficient
      const hasCover =
        !isSteamSquareIcon &&
        !coverIsDead &&
        ((assets?.coverImageUrl && !coverIsWrongRatio) ||
          (!assets?.coverImageUrl && assets?.libraryHeroImageUrl));

      if (hasCover) {
        skipped++;
        continue;
      }

      try {
        const best = await fetchBestAssets(
          game.shop,
          game.objectId,
          game.title,
          {
            iconUrl: assets?.iconUrl ?? null,
            // Never feed the wrong-ratio or dead cover back in as a fallback —
            // fetchBestAssets would just return it verbatim on a total miss.
            coverImageUrl:
              coverIsWrongRatio || coverIsDead || isSteamSquareIcon
                ? null
                : (assets?.coverImageUrl ?? null),
            libraryImageUrl: assets?.libraryImageUrl ?? null,
            libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
            logoImageUrl: assets?.logoImageUrl ?? null,
            logoPosition: assets?.logoPosition ?? null,
            downloadSources: assets?.downloadSources ?? [],
          }
        );

        await gamesShopAssetsSublevel.put(cacheKey, {
          ...(assets ?? {}),
          objectId: game.objectId,
          shop: game.shop,
          title: game.title,
          ...best,
          updatedAt: Date.now(),
        });

        const coverUrl =
          best.coverImageUrl ??
          best.libraryHeroImageUrl ??
          best.iconUrl ??
          null;

        if (!coverUrl) {
          failed++;
          results.push({
            title: game.title,
            coverUrl: null,
            what: "No usable artwork returned by GameHub, Steam, or SteamGridDB",
            status: "failed",
          });
          continue;
        }
        const found: string[] = [];
        if (best.coverImageUrl) found.push("cover");
        if (best.libraryHeroImageUrl) found.push("hero image");
        if (best.iconUrl) found.push("icon");
        if (best.logoImageUrl) found.push("logo");

        results.push({
          title: game.title,
          coverUrl,
          what:
            found.length > 0
              ? `Found: ${found.join(", ")}`
              : "Updated metadata",
          status: "updated",
        });

        updated++;
      } catch (err) {
        logger.warn(`generateMissingMetadata: failed for "${game.title}"`, err);
        failed++;
        results.push({
          title: game.title,
          coverUrl: null,
          what: err instanceof Error ? err.message : "Artwork lookup failed",
          status: "failed",
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(6, games.length) }, () => processGames())
  );

  WindowManager.sendToAppWindows("on-metadata-progress", {
    current: total,
    total,
    title: null,
    done: true,
  });
  if (updated > 0) {
    // Rehydrate any open library/game-details view immediately. Background
    // startup repair should not require a route change or app restart before
    // the newly healthy cover becomes visible.
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }
  logger.log(
    `[artwork] generateMissingMetadata: ${updated} updated, ${skipped} skipped, ${failed} failed`
  );
  return { updated, skipped, failed, results };
};

let backgroundGeneration: ReturnType<typeof generateMissingMetadata> | null =
  null;
let backgroundGenerationQueued = false;

/** Coalesce platform/startup triggers so Steam, Epic, GOG, and Xbox syncs do
 * not launch overlapping full-library artwork scans and race their writes. */
const runMissingMetadataGeneration = () => {
  if (backgroundGeneration) {
    backgroundGenerationQueued = true;
    return backgroundGeneration;
  }
  backgroundGeneration = generateMissingMetadata(
    {} as Electron.IpcMainInvokeEvent
  ).finally(() => {
    backgroundGeneration = null;
    if (backgroundGenerationQueued) {
      backgroundGenerationQueued = false;
      void runMissingMetadataGeneration();
    }
  });
  return backgroundGeneration;
};

registerEvent("generateMissingMetadata", () => runMissingMetadataGeneration());

export const generateMissingMetadataInternal = runMissingMetadataGeneration;
