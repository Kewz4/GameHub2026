import axios from "axios";
import { logger } from "./logger";
import { sgdbSearchCacheSublevel } from "@main/level";

const SGDB_BASE = "https://www.steamgriddb.com/api/v2";
const SGDB_KEY = "a41b22e5f9b93f698ff15cf05892aed6";

const headers = { Authorization: `Bearer ${SGDB_KEY}` };

interface SgdbGame {
  id: number;
  name: string;
}

interface SgdbAsset {
  url: string;
}

export interface SgdbArtwork {
  gridUrl: string | null; // vertical cover 600x900 → coverImageUrl / iconUrl
  wideGridUrl: string | null; // horizontal grid 460x215 → libraryImageUrl
  heroUrl: string | null; // hero banner → libraryHeroImageUrl
  logoUrl: string | null; // transparent logo → logoImageUrl
}

// In-memory search cache: title → SGDB game id (null = no match)
const searchCache = new Map<string, number | null>();
// In-memory artwork cache: sgdb id → artwork
const artworkCache = new Map<number, SgdbArtwork>();

/** Loose similarity check: removes edition words and punctuation, then checks overlap. */
function titlesSimilar(a: string, b: string): boolean {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[:\-–—]/g, " ")
      .replace(
        /\b(deluxe|ultimate|complete|definitive|enhanced|gold|goty|remastered|remake|edition)\b/g,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  const ca = clean(a);
  const cb = clean(b);
  return ca === cb || ca.startsWith(cb) || cb.startsWith(ca);
}

async function findSgdbGameId(title: string): Promise<number | null> {
  const key = title.trim().toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key)!;

  // Persistent cache: survives restarts so we don't re-query SGDB each scan.
  const cached = await sgdbSearchCacheSublevel.get(key).catch(() => undefined);
  if (cached) {
    searchCache.set(key, cached.gameId);
    return cached.gameId;
  }

  const remember = (id: number | null) => {
    searchCache.set(key, id);
    void sgdbSearchCacheSublevel
      .put(key, { gameId: id, cachedAt: Date.now() })
      .catch((err) => logger.warn("SteamGridDB: cache write failed", err));
  };

  try {
    const res = await axios.get<{ success: boolean; data: SgdbGame[] }>(
      `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(title.trim())}`,
      { headers, timeout: 10_000 }
    );
    const results = res.data.data ?? [];
    // Prefer exact (or near-exact) title match over blind first result
    const match =
      results.find((g) => g.name.toLowerCase() === key) ??
      results.find((g) => titlesSimilar(g.name, title)) ??
      null;
    const id = match?.id ?? null;
    remember(id);
    return id;
  } catch (err) {
    logger.warn(`SteamGridDB: search failed for "${title}"`, err);
    remember(null);
    return null;
  }
}

async function fetchOne(url: string): Promise<string | null> {
  try {
    const res = await axios.get<{ success: boolean; data: SgdbAsset[] }>(url, {
      headers,
      timeout: 10_000,
    });
    return res.data.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function getSgdbArtwork(gameId: number): Promise<SgdbArtwork> {
  if (artworkCache.has(gameId)) return artworkCache.get(gameId)!;

  const [gridUrl, wideGridUrl, heroUrl, logoUrl] = await Promise.all([
    fetchOne(`${SGDB_BASE}/grids/game/${gameId}?dimensions=600x900&limit=1`),
    fetchOne(`${SGDB_BASE}/grids/game/${gameId}?dimensions=460x215&limit=1`),
    fetchOne(`${SGDB_BASE}/heroes/game/${gameId}?limit=1`),
    fetchOne(`${SGDB_BASE}/logos/game/${gameId}?limit=1`),
  ]);

  const artwork: SgdbArtwork = { gridUrl, wideGridUrl, heroUrl, logoUrl };
  artworkCache.set(gameId, artwork);
  logger.log(`SteamGridDB: artwork for game ${gameId}`, artwork);
  return artwork;
}

/**
 * Fetch SteamGridDB artwork for a game by title.
 * Returns null if no match is found or all requests fail.
 */
export async function getSteamGridDbArtwork(
  title: string
): Promise<SgdbArtwork | null> {
  const gameId = await findSgdbGameId(title);
  if (!gameId) return null;
  return getSgdbArtwork(gameId);
}
