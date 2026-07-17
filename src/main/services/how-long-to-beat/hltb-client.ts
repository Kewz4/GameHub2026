import type { HowLongToBeatCategory } from "@types";
import { session } from "electron";
import { logger } from "../logger";
import { type HltbGame, mapHltbGame, pickBestHltbMatch } from "./hltb-parse";

/**
 * Minimal HowLongToBeat client used for console/emulated games (which the Hydra
 * backend doesn't know about, so they can't use the server-side HLTB endpoint).
 *
 * HLTB has no public API. As of their 2025 redesign the SPA resolves a rotating
 * search endpoint from its JS bundle whose full form is
 * `/api/<word>/<hexkey>` — e.g. `/api/search/21fda17e4a1d49be`. The appended
 * hex segment *is* the auth: it is baked into the JS bundle and rotates between
 * deploys, so it must be scraped at runtime and preserved in full. There is no
 * separate `<path>/init` token endpoint on the current build (older versions
 * used an `x-auth-token`/`x-hp-key`/`x-hp-val` header triplet; that scheme is
 * gone). We simply POST the search to the fully-resolved URL.
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

/**
 * Resolve the current `/api/<word>/<hexkey>` search endpoint by scraping the
 * SPA's JS bundle for the POST `fetch` call. HLTB rotates both the word and the
 * appended hex key between deploys, and the hex key *is* the auth, so the whole
 * path (word + key) must be captured — truncating to the first segment yields a
 * bare `/api/search` that 404s.
 *
 * Prefer the `_app-*` chunk, fall back to scanning every `<script src>` chunk.
 * Returns the full path (e.g. `/api/search/21fda17e4a1d49be`).
 */
async function resolveSearchEndpoint(): Promise<string | null> {
  const html = await hltbFetch(`${BASE}/`, {
    headers: { ...browserHeaders(), Accept: "text/html" },
  }).then((r) => (r.ok ? r.text() : ""));
  if (!html) return null;

  const allSrcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/gi)].map(
    (m) => m[1]
  );
  // Try the _app chunk(s) first, then any chunk — the POST call lives in a
  // lazily-loaded chunk on current builds.
  const ordered = [
    ...allSrcs.filter((s) => s.includes("_app-")),
    ...allSrcs.filter((s) => !s.includes("_app-")),
  ];

  // The search URL is a string literal built from a constant word plus the
  // rotating hex key, e.g. `"/api/search/" + "21fda17e4a1d49be"` collapsed by
  // the bundler into `"/api/search/21fda17e4a1d49be"`. Capture the full
  // `<word>/<hexkey>` — the trailing hex segment is 8+ hex chars and is the
  // part that must NOT be dropped.
  const fullSearchUrl =
    /["'`]\/api\/([a-z0-9_]+\/[a-f0-9]{8,})["'`]/i;
  // Some builds concatenate the key: `"/api/search/"+"<hex>"`. Match that too.
  const splitSearchUrl =
    /["'`]\/api\/([a-z0-9_]+)\/["'`]\s*\+\s*["'`]([a-f0-9]{8,})["'`]/i;

  for (const src of ordered) {
    const url = src.startsWith("http")
      ? src
      : `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
    try {
      const js = await hltbFetch(url, { headers: browserHeaders() }).then((r) =>
        r.ok ? r.text() : ""
      );
      const full = js.match(fullSearchUrl);
      if (full) return `/api/${full[1]}`;
      const split = js.match(splitSearchUrl);
      if (split) return `/api/${split[1]}/${split[2]}`;
    } catch {
      // try next chunk
    }
  }

  return null;
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
        rangeTime: { min: null, max: null },
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

/** POST a search to the resolved (fully-keyed) endpoint. */
async function postSearch(
  endpoint: string,
  title: string
): Promise<{ status: number; data: HltbGame[] } | null> {
  const res = await hltbFetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: browserHeaders(),
    body: JSON.stringify(searchBody(title)),
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

    const result = await postSearch(endpoint, title);

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
