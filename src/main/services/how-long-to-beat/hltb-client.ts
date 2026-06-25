import type { HowLongToBeatCategory } from "@types";
import { logger } from "../logger";
import {
  type HltbGame,
  mapHltbGame,
  pickBestHltbMatch,
} from "./hltb-parse";

/**
 * Minimal HowLongToBeat client used for console/emulated games (which the Hydra
 * backend doesn't know about, so they can't use the server-side HLTB endpoint).
 *
 * HLTB has no public API: its SPA POSTs to a search endpoint whose path token is
 * embedded in the `_app-*.js` bundle and rotates. We scrape that token, then
 * POST the search. Runs on the user's machine (residential IP + real app
 * session), where HLTB's anti-bot WAF is lenient — unlike datacenter IPs.
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

/** Scrape the rotating search-endpoint path from the SPA's `_app` bundle. */
async function resolveSearchEndpoint(): Promise<string | null> {
  const html = await fetch(`${BASE}/`, {
    headers: { ...browserHeaders(), Accept: "text/html" },
  }).then((r) => (r.ok ? r.text() : ""));
  if (!html) return null;

  const bundle = html.match(
    /\/_next\/static\/chunks\/pages\/(_app-[a-z0-9]+\.js)/i
  )?.[1];
  if (!bundle) return null;

  const js = await fetch(
    `${BASE}/_next/static/chunks/pages/${bundle}`,
    { headers: browserHeaders() }
  ).then((r) => (r.ok ? r.text() : ""));
  if (!js) return null;

  // Form: "/api/<word>/".concat("<token>")  ->  /api/<word>/<token>
  const concat = js.match(
    /"(\/api\/[a-z]+\/?)"\s*\.concat\(\s*"([a-z0-9]+)"\s*\)/i
  );
  if (concat) return `${concat[1].replace(/\/$/, "")}/${concat[2]}`;

  // Fallback: a bare /api/<word> reference (older builds).
  const bare = js.match(/"\/api\/(search|seek|s)"/i);
  if (bare) return `/api/${bare[1]}`;

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
    const res = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify(searchBody(title)),
    });
    if (!res.ok) {
      logger.log(`HLTB: search returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { data?: HltbGame[] };
    const results = Array.isArray(json.data) ? json.data : [];
    const best = pickBestHltbMatch(results, title);
    if (!best) return null;
    const categories = mapHltbGame(best);
    return categories.length ? categories : null;
  } catch (err) {
    logger.log(`HLTB: lookup failed: ${(err as Error).message}`);
    return null;
  }
}
