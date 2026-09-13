import type { HowLongToBeatCategory } from "@types";
import { session } from "electron";
import { logger } from "../logger";
import { type HltbGame, mapHltbGame, pickBestHltbMatch } from "./hltb-parse";

/**
 * Minimal HowLongToBeat client used for console/emulated games (which the Hydra
 * backend doesn't know about, so they can't use the server-side HLTB endpoint).
 *
 * HLTB has no public API. The SPA (1) scrapes a rotating search WORD from its JS
 * bundle — `/api/search`, `/api/seek`, `/api/find`… (the word changes between
 * deploys, so we discover it at runtime), (2) GETs `<endpoint>/init` for a
 * short-lived security triplet — a `token` plus a key/val pair whose field names
 * also rotate — and (3) POSTs the search to `/api/<word>` carrying that triplet
 * both as `x-auth-token`/`x-hp-key`/`x-hp-val` headers AND as a `{[key]: val}`
 * property in the JSON body. There is no auth in the URL path. (Verified against
 * the maintained howlongtobeatpy wrapper.)
 *
 * Requests go through Electron's session.fetch (Chromium's network stack)
 * rather than Node's fetch (undici). This is critical: HLTB uses an Imperva WAF
 * that fingerprints the TLS connection — undici's TLS fingerprint is
 * recognisably non-browser and gets 403'd, whereas Chromium's fingerprint
 * matches a real Chrome browser and passes. Session.fetch also handles cookies
 * automatically, which the WAF requires.
 *
 * Everything is best-effort: any failure returns null and the UI simply omits
 * the HLTB section, exactly like a PC game with no HLTB data.
 */

const BASE = "https://howlongtobeat.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Chromium-backed fetch that shares the default session's cookie jar and TLS
 * fingerprint. Falls back to global fetch if the session is unavailable (e.g.
 * during early startup), though in practice IPC handlers always run after the
 * app is ready.
 */
async function hltbFetch(
  url: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Promise<Response> {
  const ses = session.defaultSession;
  if (ses && typeof ses.fetch === "function") {
    return ses.fetch(url, init as RequestInit);
  }
  return fetch(url, init as RequestInit);
}

const browserHeaders = () => ({
  "User-Agent": UA,
  Referer: `${BASE}/`,
  Origin: BASE,
  "Content-Type": "application/json",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
});

/** Fallback search word when the JS scrape can't find one (HLTB's own default). */
const FALLBACK_SEARCH_WORD = "s";

/**
 * Resolve the current `/api/<word>` search endpoint by scraping the SPA's JS
 * bundle for the POST `fetch` call. HLTB rotates the word between deploys
 * (`/api/search`, `/api/seek`, `/api/find`…). The auth is NOT in the URL — it
 * comes from a separate `<endpoint>/init` call (see resolveAuth). Prefer the
 * `_app-*` chunk, fall back to every `<script src>` chunk, then to `/api/s`.
 * (Scheme verified against the maintained howlongtobeatpy wrapper.)
 */
async function resolveSearchEndpoint(): Promise<string | null> {
  const html = await hltbFetch(`${BASE}/`, {
    headers: { ...browserHeaders(), Accept: "text/html" },
  }).then((r) => (r.ok ? r.text() : ""));
  if (!html) return `/api/${FALLBACK_SEARCH_WORD}`;

  const allSrcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/gi)].map(
    (m) => m[1]
  );
  const ordered = [
    ...allSrcs.filter((s) => s.includes("_app-")),
    ...allSrcs.filter((s) => !s.includes("_app-")),
  ];

  // Grab the base word of the POST fetch: fetch("/api/<word>...", {..method:POST..}).
  const postFetch =
    /fetch\s*\(\s*["'`]\/api\/([a-z0-9_/]+)[^"'`]*["'`]\s*,\s*\{[^}]*method\s*:\s*["'`]POST["'`]/i;

  for (const src of ordered) {
    const url = src.startsWith("http")
      ? src
      : `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
    try {
      const js = await hltbFetch(url, { headers: browserHeaders() }).then(
        (r) => (r.ok ? r.text() : "")
      );
      const m = js.match(postFetch);
      if (m) return `/api/${m[1].split("/")[0]}`; // just the base word
    } catch {
      // try next chunk
    }
  }

  return `/api/${FALLBACK_SEARCH_WORD}`;
}

interface HltbAuth {
  token: string;
  /** The short-lived key + value the search must echo in headers AND the body. */
  authKey: string;
  authVal: string;
}

/**
 * Fetch the search security triplet from `<endpoint>/init`. The response carries
 * `token` plus two fields whose NAMES contain "key"/"val" (the exact names
 * rotate). The search then sends them as x-auth-token / x-hp-key / x-hp-val
 * headers AND a `{ [authKey]: authVal }` property in the body.
 */
async function resolveAuth(endpoint: string): Promise<HltbAuth | null> {
  try {
    const res = await hltbFetch(`${BASE}${endpoint}/init?t=${Date.now()}`, {
      headers: browserHeaders(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    let token = "";
    let authKey = "";
    let authVal = "";
    for (const [name, value] of Object.entries(json)) {
      const lower = name.toLowerCase();
      if (lower === "token") token = String(value);
      else if (lower.includes("key")) authKey = String(value);
      else if (lower.includes("val")) authVal = String(value);
    }
    if (!token && !authKey) return null;
    return { token, authKey, authVal };
  } catch {
    return null;
  }
}

function searchBody(title: string) {
  return {
    searchType: "games",
    searchTerms: title.split(/\s+/).filter(Boolean),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: "",
        sortCategory: "popular",
        rangeCategory: "main",
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
        rangeYear: { min: "", max: "" },
        modifier: "",
      },
      users: { sortCategory: "postcount" },
      lists: { sortCategory: "follows" },
      filter: "",
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  };
}

/** POST a search to the resolved endpoint, carrying the init auth triplet. */
async function postSearch(
  endpoint: string,
  title: string,
  auth: HltbAuth | null
): Promise<{ status: number; data: HltbGame[] } | null> {
  const headers: Record<string, string> = { ...browserHeaders() };
  const body = searchBody(title) as Record<string, unknown>;
  if (auth) {
    if (auth.token) headers["x-auth-token"] = auth.token;
    if (auth.authKey) headers["x-hp-key"] = auth.authKey;
    if (auth.authVal) headers["x-hp-val"] = auth.authVal;
    // The search must also echo the key/val as a top-level body property.
    if (auth.authKey) body[auth.authKey] = auth.authVal;
  }
  const res = await hltbFetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) return { status: res.status, data: [] };
  const json = (await res.json()) as { data?: HltbGame[] };
  return {
    status: res.status,
    data: Array.isArray(json.data) ? json.data : [],
  };
}

/**
 * Look up HowLongToBeat times for a title. Returns the category list, or null
 * if HLTB is unreachable or has no confident match.
 */
export async function fetchHowLongToBeat(
  title: string
): Promise<HowLongToBeatCategory[] | null> {
  try {
    const endpoint = await resolveSearchEndpoint();
    if (!endpoint) {
      logger.log("HLTB: could not resolve search endpoint");
      return null;
    }

    // Load the homepage first so session.fetch carries the same cookies the
    // real SPA would when it POSTs the search.
    await hltbFetch(`${BASE}/`, {
      headers: { ...browserHeaders(), Accept: "text/html" },
    }).catch(() => undefined);

    let auth = await resolveAuth(endpoint);
    let result = await postSearch(endpoint, title, auth);

    // The init token is short-lived; on 401/403 refresh it once and retry (the
    // SPA does the same: "Search token expired, refreshing and retrying…").
    if (result && (result.status === 401 || result.status === 403)) {
      auth = await resolveAuth(endpoint);
      result = await postSearch(endpoint, title, auth);
    }

    if (!result || result.status !== 200) {
      logger.log(`HLTB: search returned ${result?.status ?? "no response"}`);
      return null;
    }

    const best = pickBestHltbMatch(result.data, title);
    if (!best) return null;
    const categories = mapHltbGame(best);
    return categories.length ? categories : null;
  } catch (err) {
    logger.log(`HLTB: lookup failed: ${(err as Error).message}`);
    return null;
  }
}
