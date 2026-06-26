import type { HowLongToBeatCategory } from "@types";
import { logger } from "../logger";
import { type HltbGame, mapHltbGame, pickBestHltbMatch } from "./hltb-parse";

/**
 * Minimal HowLongToBeat client used for console/emulated games (which the Hydra
 * backend doesn't know about, so they can't use the server-side HLTB endpoint).
 *
 * HLTB has no public API. As of their 2025 redesign the SPA resolves a rotating
 * `/api/<path>` search endpoint from its JS bundle (the path changes between
 * deploys — `/api/search`, `/api/seek`, `/api/bleed` have all been seen), then
 * GETs `<path>/init` for a short-lived `{ token, hpKey, hpVal }` security
 * triplet and POSTs the search to `<path>` carrying that triplet as the
 * `x-auth-token` / `x-hp-key` / `x-hp-val` headers. The token embeds the
 * caller's egress IP + User-Agent, so it must be used from the same session
 * that minted it. Runs on the user's machine (residential IP + real app
 * session), where HLTB's anti-bot WAF is lenient — unlike datacenter IPs, which
 * it rejects with "Session expired or invalid fingerprint" (or a soft 404).
 *
 * Everything is best-effort: any failure returns null and the UI simply omits
 * the HLTB section, exactly like a PC game with no HLTB data.
 */

const BASE = "https://howlongtobeat.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const browserHeaders = () => ({
  "User-Agent": UA,
  Referer: `${BASE}/`,
  Origin: BASE,
  "Content-Type": "application/json",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
});

interface BleedSecurity {
  token: string;
  hpKey: string;
  hpVal: string;
}

/**
 * Resolve the current `/api/<path>` search endpoint by scraping the SPA's JS
 * bundle for the POST `fetch` call. HLTB rotates this path between deploys
 * (observed values include `/api/search`, `/api/seek`, `/api/bleed`), so it
 * must be discovered at runtime rather than hard-coded. Returns the base path
 * (e.g. `/api/bleed`); the matching token endpoint is `<base>/init`.
 *
 * Mirrors the strategy of the maintained `howlongtobeatpy` package: prefer the
 * `_app-*` chunk, fall back to scanning every `<script src>` chunk.
 */
async function resolveSearchEndpoint(): Promise<string | null> {
  const html = await fetch(`${BASE}/`, {
    headers: { ...browserHeaders(), Accept: "text/html" },
  }).then((r) => (r.ok ? r.text() : ""));
  if (!html) return null;

  const allSrcs = [
    ...html.matchAll(/<script[^>]+src="([^"]+\.js)"/gi),
  ].map((m) => m[1]);
  // Try the _app chunk(s) first, then any chunk — the POST call lives in a
  // lazily-loaded chunk on current builds.
  const ordered = [
    ...allSrcs.filter((s) => s.includes("_app-")),
    ...allSrcs.filter((s) => !s.includes("_app-")),
  ];

  // Confirm the endpoint by the POST method so we don't grab the GET init call.
  const postFetch =
    /fetch\s*\(\s*["']\/api\/([a-zA-Z0-9_]+)[^"']*["']\s*,\s*\{[^}]*method:\s*["']POST["']/i;

  for (const src of ordered) {
    const url = src.startsWith("http")
      ? src
      : `${BASE}${src.startsWith("/") ? "" : "/"}${src}`;
    try {
      const js = await fetch(url, { headers: browserHeaders() }).then((r) =>
        r.ok ? r.text() : ""
      );
      const m = js.match(postFetch);
      if (m) return `/api/${m[1]}`;
    } catch {
      // try next chunk
    }
  }
  return null;
}

/**
 * Fetch the short-lived search security triplet from `<endpoint>/init`. The
 * homepage is loaded first so the request carries the same cookies/session the
 * real SPA would, then init mints the token bound to this caller.
 */
async function initSearchSecurity(
  endpoint: string
): Promise<BleedSecurity | null> {
  try {
    const res = await fetch(`${BASE}${endpoint}/init?t=${Date.now()}`, {
      headers: browserHeaders(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<BleedSecurity>;
    if (!json.token || !json.hpKey || !json.hpVal) return null;
    return { token: json.token, hpKey: json.hpKey, hpVal: json.hpVal };
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

/** POST a search to the resolved endpoint with the given security triplet. */
async function postSearch(
  endpoint: string,
  title: string,
  security: BleedSecurity
): Promise<{ status: number; data: HltbGame[] } | null> {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: {
      ...browserHeaders(),
      "x-auth-token": security.token,
      "x-hp-key": security.hpKey,
      "x-hp-val": security.hpVal,
    },
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

    let security = await initSearchSecurity(endpoint);
    if (!security) {
      logger.log("HLTB: could not obtain search security token");
      return null;
    }

    let result = await postSearch(endpoint, title, security);
    // The token expires quickly; on 403 refresh it once and retry, exactly as
    // the SPA does ("Search token expired, refreshing and retrying...").
    if (result?.status === 403) {
      security = await initSearchSecurity(endpoint);
      if (security) result = await postSearch(endpoint, title, security);
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
