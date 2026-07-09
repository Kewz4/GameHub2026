import axios from "axios";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";

import type { GameBananaMod, GameBananaModDetail } from "@types";
import { logger } from "./logger";

/**
 * GameBanana (apiv11) client for browsing Breath of the Wild mods and fetching
 * their downloadable files. BOTW's GameBanana game id is 5866; its mods are
 * distributed as `.bnp` archives which UKMM installs natively.
 */

const GB_API = "https://gamebanana.com/apiv11";
const BOTW_GAME_ID = 5866;

const firstImage = (record: any): string | null => {
  const media = record?._aPreviewMedia?._aImages;
  if (Array.isArray(media) && media.length > 0) {
    const img = media[0];
    const base = img?._sBaseUrl;
    const file = img?._sFile530 ?? img?._sFile ?? img?._sFile220;
    if (base && file) return `${base}/${file}`;
  }
  return null;
};

const mapRecord = (r: any): GameBananaMod => ({
  id: Number(r._idRow),
  name: String(r._sName ?? "Unknown"),
  category: r?._aRootCategory?._sName ?? null,
  submitter: r?._aSubmitter?._sName ?? null,
  imageUrl: firstImage(r),
  likes: Number(r._nLikeCount ?? 0),
  views: Number(r._nViewCount ?? 0),
  profileUrl: String(r._sProfileUrl ?? ""),
});

export type ModSort = "newest" | "updated" | "likes" | "downloads";

const SORT_ALIAS: Record<ModSort, string> = {
  newest: "Generic_Newest",
  updated: "Generic_LatestModified",
  likes: "Generic_MostLiked",
  downloads: "Generic_MostDownloaded",
};

export interface BrowseOptions {
  page?: number;
  perPage?: number;
  sort?: ModSort;
  /** GameBanana category row id (from listCategories), or null for all. */
  categoryId?: number | null;
  /** Free-text search query. */
  search?: string;
}

/** List/search BOTW mods with sorting + category filtering. */
export const listBotwMods = async (
  opts: BrowseOptions = {}
): Promise<GameBananaMod[]> => {
  const { page = 1, perPage = 15, sort = "newest", categoryId, search } = opts;
  try {
    // Free-text search goes through the search endpoint; browse/filter uses the
    // index endpoint (which supports sort + category filters). GameBanana's
    // search 400s on a single character, so only search with 2+ chars.
    if (search && search.trim().length >= 2) {
      const resp = await axios.get(`${GB_API}/Util/Search/Results`, {
        params: {
          _sSearchString: search.trim(),
          _idGameRow: BOTW_GAME_ID,
          _sModelName: "Mod",
          _nPage: page,
          _nPerpage: perPage,
        },
        timeout: 15_000,
        headers: { "User-Agent": "GameHub" },
      });
      const records: any[] = resp.data?._aRecords ?? [];
      return records.map(mapRecord);
    }

    const params: Record<string, unknown> = {
      _nPage: page,
      _nPerpage: perPage,
      "_aFilters[Generic_Game]": BOTW_GAME_ID,
      _sSort: SORT_ALIAS[sort],
    };
    if (categoryId) params["_aFilters[Generic_Category]"] = categoryId;

    const resp = await axios.get(`${GB_API}/Mod/Index`, {
      params,
      timeout: 15_000,
      headers: { "User-Agent": "GameHub" },
    });
    const records: any[] = resp.data?._aRecords ?? [];
    return records.filter((r) => !r?._bIsObsolete).map(mapRecord);
  } catch (err) {
    logger.warn("[gamebanana] listBotwMods failed", err);
    return [];
  }
};

/** BOTW mod categories (id + name), for the filter dropdown. */
export const listCategories = async (): Promise<
  { id: number; name: string }[]
> => {
  try {
    const resp = await axios.get(`${GB_API}/Mod/Categories`, {
      params: { _idGameRow: BOTW_GAME_ID, _sSort: "a_to_z", _bShowEmpty: true },
      timeout: 15_000,
      headers: { "User-Agent": "GameHub" },
    });
    const recs: any[] = Array.isArray(resp.data)
      ? resp.data
      : (resp.data?._aRecords ?? []);
    return recs
      .map((c) => ({ id: Number(c._idRow), name: String(c._sName ?? "") }))
      .filter((c) => c.id && c.name);
  } catch (err) {
    logger.warn("[gamebanana] listCategories failed", err);
    return [];
  }
};

/** Fetch a mod's full profile (description, gallery, files). */
export const getModDetail = async (
  modId: number
): Promise<GameBananaModDetail | null> => {
  try {
    const resp = await axios.get(`${GB_API}/Mod/${modId}/ProfilePage`, {
      timeout: 15_000,
      headers: { "User-Agent": "GameHub" },
    });
    const d = resp.data ?? {};
    const gallery: string[] = [];
    const media = d?._aPreviewMedia?._aImages;
    if (Array.isArray(media)) {
      for (const img of media) {
        const base = img?._sBaseUrl;
        const file = img?._sFile ?? img?._sFile530;
        if (base && file) gallery.push(`${base}/${file}`);
      }
    }
    const files = (d?._aFiles ?? []).map((f: any) => ({
      id: Number(f._idRow),
      fileName: String(f._sFile ?? `mod-${f._idRow}`),
      sizeBytes: Number(f._nFilesize ?? 0),
      downloadUrl: String(f._sDownloadUrl ?? `https://gamebanana.com/dl/${f._idRow}`),
    }));
    return {
      id: Number(d._idRow ?? modId),
      name: String(d._sName ?? "Unknown"),
      description: String(d._sText ?? ""),
      submitter: d?._aSubmitter?._sName ?? null,
      likes: Number(d._nLikeCount ?? 0),
      views: Number(d._nViewCount ?? 0),
      profileUrl: String(d._sProfileUrl ?? ""),
      gallery,
      files,
    };
  } catch (err) {
    logger.warn(`[gamebanana] getModDetail(${modId}) failed`, err);
    return null;
  }
};

/**
 * Resolve a `bcml:` 1-click install URI into a direct download URL.
 * Format: `bcml:https://gamebanana.com/mmdl/<fileId>,Mod,<modId>`.
 */
export const resolveBcmlUri = (uri: string): string | null => {
  const withoutScheme = uri.replace(/^bcml:/i, "");
  const url = withoutScheme.split(",")[0]?.trim();
  if (!url) return null;
  // Normalise /mmdl/<id> to the stable /dl/<id> download endpoint.
  const m = url.match(/\/(?:mmdl|dl)\/(\d+)/);
  if (m) return `https://gamebanana.com/dl/${m[1]}`;
  return url;
};

/** Download a GameBanana mod file to a destination path. */
export const downloadModFile = async (
  downloadUrl: string,
  destDir: string,
  fileName: string
): Promise<string> => {
  const dest = path.join(destDir, fileName);
  const resp = await axios.get<NodeJS.ReadableStream>(downloadUrl, {
    responseType: "stream",
    timeout: 0,
    maxRedirects: 5,
    headers: { "User-Agent": "GameHub" },
  });
  await pipeline(resp.data, createWriteStream(dest));
  return dest;
};
