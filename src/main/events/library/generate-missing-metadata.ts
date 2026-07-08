import axios from "axios";
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

export interface MetadataGameResult {
  title: string;
  coverUrl: string | null;
  what: string;
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
 * 4xx/5xx = dead (re-fetch). Network errors count as alive so an offline run
 * doesn't wipe every game's artwork.
 */
const isCoverUrlAlive = async (
  url: string | null | undefined
): Promise<boolean> => {
  if (!url || !/^https?:\/\//i.test(url)) return Boolean(url);
  try {
    const res = await axios.head(url, {
      timeout: 5_000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    // Some CDNs reject HEAD (405) while serving GET fine — treat as alive.
    if (res.status === 405 || res.status === 501) return true;
    return res.status < 400;
  } catch {
    return true;
  }
};

const generateMissingMetadata = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{
  updated: number;
  skipped: number;
  results: MetadataGameResult[];
}> => {
  const allGames = await gamesSublevel.values().all();
  const games = allGames.filter((g) => !g.isDeleted);

  let updated = 0;
  let skipped = 0;
  const total = games.length;
  let current = 0;
  const results: MetadataGameResult[] = [];

  WindowManager.sendToAppWindows("on-metadata-progress", {
    current,
    total,
    title: null,
  });

  for (const game of games) {
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
            coverUrl: merged.coverImageUrl ?? merged.libraryHeroImageUrl ?? null,
            what: found.length ? `Found: ${found.join(", ")}` : "Updated art",
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

    // Steam games must use the authoritative CDN portrait grid. If the stored
    // cover isn't already the library_600x900.jpg, treat it as outdated.
    const isSteamButNotCdn =
      game.shop === "steam" &&
      assets?.coverImageUrl != null &&
      !assets.coverImageUrl.includes("library_600x900");

    // A stored cover URL that 404s counts as missing — otherwise the game is
    // skipped forever while its card shows the broken-image placeholder.
    const coverIsDead =
      Boolean(assets?.coverImageUrl) &&
      !coverIsWrongRatio &&
      !(await isCoverUrlAlive(assets?.coverImageUrl));

    // Only skip if we have an actual cover or hero image — icon alone is not sufficient
    const hasCover =
      !isSteamButNotCdn &&
      !coverIsDead &&
      ((assets?.coverImageUrl && !coverIsWrongRatio) ||
        (!assets?.coverImageUrl && assets?.libraryHeroImageUrl));

    if (hasCover) {
      skipped++;
      continue;
    }

    try {
      const best = await fetchBestAssets(game.shop, game.objectId, game.title, {
        iconUrl: assets?.iconUrl ?? null,
        // Never feed the wrong-ratio or dead cover back in as a fallback —
        // fetchBestAssets would just return it verbatim on a total miss.
        coverImageUrl:
          coverIsWrongRatio || coverIsDead
            ? null
            : (assets?.coverImageUrl ?? null),
        libraryImageUrl: assets?.libraryImageUrl ?? null,
        libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
        logoImageUrl: assets?.logoImageUrl ?? null,
        logoPosition: assets?.logoPosition ?? null,
        downloadSources: assets?.downloadSources ?? [],
      });

      await gamesShopAssetsSublevel.put(cacheKey, {
        ...(assets ?? {}),
        objectId: game.objectId,
        shop: game.shop,
        title: game.title,
        ...best,
        updatedAt: Date.now(),
      });

      const coverUrl =
        best.coverImageUrl ?? best.libraryHeroImageUrl ?? best.iconUrl ?? null;
      const found: string[] = [];
      if (best.coverImageUrl) found.push("cover");
      if (best.libraryHeroImageUrl) found.push("hero image");
      if (best.iconUrl) found.push("icon");
      if (best.logoImageUrl) found.push("logo");

      results.push({
        title: game.title,
        coverUrl,
        what:
          found.length > 0 ? `Found: ${found.join(", ")}` : "Updated metadata",
      });

      updated++;
    } catch (err) {
      logger.warn(`generateMissingMetadata: failed for "${game.title}"`, err);
      skipped++;
    }
  }

  WindowManager.sendToAppWindows("on-metadata-progress", {
    current: total,
    total,
    title: null,
    done: true,
  });
  logger.log(`generateMissingMetadata: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped, results };
};

registerEvent("generateMissingMetadata", generateMissingMetadata);

export const generateMissingMetadataInternal = () =>
  generateMissingMetadata({} as Electron.IpcMainInvokeEvent);
