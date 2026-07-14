#!/usr/bin/env node
/**
 * GameHub console metadata generator (offline, run-once / periodic).
 *
 * Walks the GameHub Vault dump (Dump/<console>/games.json — the brothers' USA
 * game dumps) and, for every base game, resolves:
 *   - SteamGridDB artwork (cover / wide grid / hero / logo)
 *   - IGDB metadata (description, genres, release year)
 * and writes a flat, GitHub-hostable dataset to
 * sources/gamehub-meta/<system>.json keyed by the SAME normalized title the
 * app uses at runtime. The app fetches these files raw from GitHub — no live
 * SGDB/IGDB calls on the user's launch path (those rate-limit and need keys).
 *
 * This is the "GameHubAPI" — a static dataset, not a server.
 *
 * Dump layout (USA-only, direct hoster links):
 *   Dump/3ds/games.json        → n3ds
 *   Dump/ds/games.json         → nds
 *   Dump/gamecube/games.json   → gc
 *   Dump/gb_gba_gbc/games.json → gb, gbc AND gba (merged; RALibretro auto-
 *                                 detects at launch, so one set of titles is
 *                                 mirrored to all three meta files)
 *   Dump/n64/games.json        → n64
 *   Dump/ps1/games.json       → ps1
 *   Dump/ps2/games.json       → ps2
 *   Dump/ps3/games.json       → ps3
 *   Dump/psp/games.json       → psp
 *   Dump/wii/games.json       → wii
 *   Dump/wiiu/games.json      → wiiu
 *   (dsi has no dump folder — DSi games aren't in the brothers' collection, so
 *   no meta is generated for it; the runtime loader silently skips a missing
 *   dsi.json.)
 *
 * Usage:
 *   node scripts/generate-gamehub-metadata.cjs [systems...] [--force] [--limit N]
 *
 *   systems   one or more of ps1 ps2 ps3 psp n3ds nds n64 gb gbc gba
 *             wiiu wii gc   (default: all)
 *   --force   re-resolve titles already present in the output (default: skip)
 *   --limit N only process the first N titles per system (smoke testing)
 *
 * Resumable: existing output entries are preserved and skipped unless --force.
 * Rate-limited and retrying so a long full run survives transient 429s.
 */
const fs = require("node:fs");
const path = require("node:path");

// ---- credentials (same embedded keys the app ships with) -------------------
const SGDB_KEY = process.env.SGDB_API_KEY || "a41b22e5f9b93f698ff15cf05892aed6";
const IGDB_CLIENT_ID =
  process.env.IGDB_CLIENT_ID || "lbccfxg1ie3739dubo4bvlj7bw0sue";
const IGDB_CLIENT_SECRET =
  process.env.IGDB_CLIENT_SECRET || "e88mbm5snb40ax0n37jpyhearwfikp";
const RAWG_KEY = process.env.RAWG_API_KEY || "c7078ab3bd194426be249d6dc36a3c40";

const SGDB_BASE = "https://www.steamgriddb.com/api/v2";
const RAWG_BASE = "https://api.rawg.io/api";

const DUMP_DIR = path.join(__dirname, "..", "Dump");
const OUT_DIR = path.join(__dirname, "..", "sources", "gamehub-meta");
/** Checkpoint file tracking completed systems so a crash/resume skips them
 *  entirely instead of re-reading games.json + re-checking every cached entry. */
const CHECKPOINT_FILE = path.join(OUT_DIR, ".checkpoint.json");

/**
 * EmulatorSystem → Dump folder. Reverse of CONSOLE_MAP in
 * src/main/services/rom-sources/gamehub-dump-sources.ts. gb/gbc/gba all read
 * from the merged gb_gba_gbc folder (the dump stores them together because
 * RALibretro auto-detects the console from the file extension at launch).
 */
const SYSTEM_TO_DUMP_FOLDER = {
  n3ds: "3ds",
  nds: "ds",
  gc: "gamecube",
  gb: "gb_gba_gbc",
  gbc: "gb_gba_gbc",
  gba: "gb_gba_gbc",
  n64: "n64",
  ps1: "ps1",
  ps2: "ps2",
  ps3: "ps3",
  psp: "psp",
  wii: "wii",
  wiiu: "wiiu",
};

const ALL_SYSTEMS = Object.keys(SYSTEM_TO_DUMP_FOLDER);

/** IGDB platform ids — must match src/main/services/igdb.ts IGDB_PLATFORM_IDS. */
const IGDB_PLATFORM_IDS = {
  n64: 4,
  gb: 33,
  gbc: 22,
  gba: 24,
  nds: 20,
  dsi: 170,
  n3ds: 37,
  wii: 5,
  wiiu: 41,
  gc: 21,
  psp: 38,
  ps1: 7,
  ps2: 8,
  ps3: 9,
};

/** RAWG platform IDs — from https://api.rawg.io/docs/#operation/games_list.
 *  Used to filter search results by console for better matching. */
const RAWG_PLATFORM_IDS = {
  ps1: 18,
  ps2: 16,
  ps3: 15,
  psp: 14,
  n3ds: 8,
  nds: 9,
  n64: 7,
  gb: 6,
  gbc: 6,
  gba: 5,
  wii: 10,
  wiiu: 11,
  gc: 2,
};

// ---- helpers ---------------------------------------------------------------

/**
 * MUST match normalizeRomTitle in
 * src/main/services/emulators/parse-rom-filename.ts (re-exported as
 * normalizeTitle by the old minerva-source.ts and used by the catalogue
 * sublevel). Folds accents and drops comma-shifted/leading articles BEFORE
 * squashing non-alphanumerics, so the No-Intro form ("Zelda, The - …") and the
 * natural display form ("The Legend of Zelda: …") normalize to the SAME key.
 */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/,\s*(the|an|a)\b/g, "")
    .replace(/^(the|an|a)\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

// ---- checkpoint + memory management -----------------------------------------

/** RAM threshold (MB available) below which the generator pauses and waits
 *  for memory to free up before continuing. The VPS has 4 GB; Playwright +
 *  Chrome from the other scrapers can eat ~1.5 GB, so we pause when available
 *  drops below 300 MB to avoid OOM kills. */
const MIN_AVAILABLE_RAM_MB = 300;
/** How often (ms) to re-check RAM while paused. */
const RAM_POLL_INTERVAL_MS = 5000;

/** Read available RAM in MB from /proc/meminfo (Linux only). Returns Infinity
 *  on non-Linux so the check is a no-op there. */
function availableRamMB() {
  if (process.platform !== "linux") return Infinity;
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
    const match = meminfo.match(/^MemAvailable:\s+(\d+)/m);
    return match ? Math.floor(parseInt(match[1], 10) / 1024) : Infinity;
  } catch {
    return Infinity;
  }
}

/** If available RAM is below the threshold, block until it recovers. Logs
 *  pause/resume so the monitor shows what's happening. */
async function waitForRamIfNeeded() {
  const avail = availableRamMB();
  if (avail >= MIN_AVAILABLE_RAM_MB) return;

  process.stdout.write(
    `⏸  low RAM (${avail} MB available < ${MIN_AVAILABLE_RAM_MB} MB threshold) — pausing until memory frees up…\n`
  );
  while (true) {
    await sleep(RAM_POLL_INTERVAL_MS);
    const now = availableRamMB();
    if (now >= MIN_AVAILABLE_RAM_MB) {
      process.stdout.write(
        `▶  RAM recovered (${now} MB available) — resuming.\n`
      );
      return;
    }
  }
}

/** Load the checkpoint file (systems already completed in a prior run). */
function loadCheckpoint() {
  try {
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    return new Set(data.completed ?? []);
  } catch {
    return new Set();
  }
}

/** Mark a system as completed in the checkpoint file. */
function saveCheckpoint(completed) {
  try {
    fs.writeFileSync(
      CHECKPOINT_FILE,
      JSON.stringify({ completed, updatedAt: Date.now() }, null, 2)
    );
  } catch (err) {
    process.stderr.write(`checkpoint save failed: ${err}\n`);
  }
}

/** Strip edition/region noise to improve IGDB/SGDB match rates. */
function cleanTitle(title) {
  return title
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Move a trailing article ("Zelda, The" -> "The Zelda") on one segment. */
function fixArticle(segment) {
  const m = segment.match(/^(.*),\s+(The|A|An)$/i);
  return m ? `${m[2]} ${m[1]}`.trim() : segment;
}

/**
 * Convert a No-Intro/Redump ROM title to the form IGDB indexes:
 *   "Legend of Zelda, The - Breath of the Wild"
 *     -> "The Legend of Zelda: Breath of the Wild"
 * The `, The` article suffix and ` - ` subtitle separator break IGDB search
 * otherwise (worst on marquee first-party titles). SGDB is more forgiving so
 * it keeps using cleanTitle; this is for the IGDB query only.
 */
function igdbTitle(title) {
  const cleaned = cleanTitle(title) || title;
  return cleaned
    .split(/\s+-\s+/)
    .map(fixArticle)
    .join(": ");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, options = {}, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const wait = 1000 * Math.pow(2, attempt);
        process.stderr.write(`  rate-limited, waiting ${wait}ms\n`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      if (attempt === retries) {
        process.stderr.write(`  fetch failed: ${err.message}\n`);
        return null;
      }
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  return null;
}

// ---- IGDB ------------------------------------------------------------------

let igdbToken = null;
async function igdbAuth() {
  if (igdbToken) return igdbToken;
  const data = await fetchJson(
    `https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!data?.access_token) throw new Error("IGDB auth failed");
  igdbToken = data.access_token;
  return igdbToken;
}

/** Significant lowercase tokens (drop short words / common edition noise). */
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "version",
  "edition",
  "game",
]);
function tokenize(name) {
  // Split camelCase first, then tokenize
  const camelExpanded = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const base = camelExpanded
    // Fold accents so "Pokémon" tokenizes to "pokemon" (not "pok"+"mon"),
    // otherwise the coverage check wrongly rejects accented IGDB matches.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  // Also add pairwise-joined forms so "Mega Man" -> "megaman" matches "Megaman"
  const joined = [];
  for (let i = 0; i < base.length - 1; i++) joined.push(base[i] + base[i + 1]);
  return [...new Set([...base, ...joined])];
}

/** Count of symbol differences between two token lists (as sets). */
function tokenSymDiff(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let d = 0;
  for (const x of A) if (!B.has(x)) d++;
  for (const x of B) if (!A.has(x)) d++;
  return d;
}

/** # of leading candidate tokens not present in the query (prefix-hack guard:
 *  real subtitles append words, hacks like "Shin Pokemon" prepend them). */
function leadingExtra(qTokens, cTokens) {
  let i = 0;
  while (i < cTokens.length && !qTokens.includes(cTokens[i])) i++;
  return i;
}

/**
 * Resolve a game on IGDB using its relevance-ranked `search` index (handles
 * punctuation/articles far better than a `name ~ *"..."*` substring) and then
 * select defensively:
 *   - token guard: candidate & query must share most of their significant
 *     tokens (rejects token-sharing junk like "Shin Pokemon" for "Pokemon Red")
 *   - no leading extra tokens (prefix-hack guard)
 *   - sort by token-set difference, then EARLIEST release date (prefer the
 *     original over later re-releases/ports), then IGDB relevance.
 * Returns null rather than a dubious match — a null field beats wrong data.
 */
async function igdbSearch(title, platformId) {
  const token = await igdbAuth();
  const query = `search "${title.replace(/"/g, "")}";
fields name,summary,first_release_date,genres.name,platforms;
limit 20;`;
  const data = await fetchJson("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-ID": IGDB_CLIENT_ID,
      "Content-Type": "text/plain",
    },
    body: query,
  });
  if (!Array.isArray(data) || data.length === 0) return null;

  const qTokens = tokenize(title);
  if (qTokens.length === 0) return null;

  const scored = data
    .map((g, rank) => {
      const cTokens = tokenize(g.name || "");
      const shared = cTokens.filter((t) => qTokens.includes(t)).length;
      const candidateCovered = cTokens.length ? shared / cTokens.length : 0;
      const queryCovered = shared / qTokens.length;
      return {
        g,
        candidateCovered,
        queryCovered,
        sd: tokenSymDiff(qTokens, cTokens),
        date: g.first_release_date ?? Number.MAX_SAFE_INTEGER,
        rank,
        lead: leadingExtra(qTokens, cTokens),
      };
    })
    .filter(
      (x) => x.candidateCovered >= 0.6 && x.queryCovered >= 0.6 && x.lead === 0
    );
  if (scored.length === 0) return null;

  scored.sort(
    (a, b) =>
      a.sd - b.sd ||
      a.date - b.date ||
      (platformId
        ? platformPref(a, platformId) - platformPref(b, platformId)
        : 0) ||
      a.rank - b.rank
  );
  return scored[0].g;
}

/** 0 if the candidate lists the target platform, 1 otherwise (tiebreak only). */
function platformPref(x, platformId) {
  return Array.isArray(x.g.platforms) && x.g.platforms.includes(platformId)
    ? 0
    : 1;
}

// ---- RAWG.io (screenshots, developers, publishers) -------------------------

/**
 * Search RAWG for a game by title, optionally filtered by platform. Returns
 * the first result's screenshots + developer/publisher info, or null.
 *
 * RAWG's search returns `short_screenshots` inline (no extra request needed).
 * Developer/publisher info requires a follow-up details call.
 */
async function rawgSearch(title, system) {
  const platformId = RAWG_PLATFORM_IDS[system];
  const params = new URLSearchParams({
    key: RAWG_KEY,
    search: title,
    page_size: "5",
  });
  if (platformId) params.set("platforms", String(platformId));

  const data = await fetchJson(`${RAWG_BASE}/games?${params.toString()}`);
  const results = data?.results ?? [];
  if (results.length === 0) return null;

  // Pick the best match: exact name match, then closest by token similarity.
  const clean = title
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim()
    .toLowerCase();
  let best = results[0];
  let bestScore = Infinity;
  for (const r of results) {
    const name = (r.name || "").toLowerCase();
    const score =
      name === clean
        ? 0
        : name.includes(clean) || clean.includes(name)
          ? 1
          : tokenSymDiff(tokenize(name), tokenize(clean));
    const pref = platformId
      ? (r.parent_platforms ?? []).some((p) => p.platform?.id === platformId)
        ? 0
        : 1
      : 0;
    if (score + pref * 0.5 < bestScore) {
      bestScore = score + pref * 0.5;
      best = r;
    }
  }

  // Screenshots are inline in the search response.
  const screenshots = (best.short_screenshots ?? [])
    .map((s) => s.image)
    .filter(Boolean)
    .slice(0, 10);

  // Fetch game details for developer/publisher info.
  let developers = [];
  let publishers = [];
  let description = null;
  try {
    const details = await fetchJson(
      `${RAWG_BASE}/games/${best.id}?key=${RAWG_KEY}`
    );
    developers = (details?.developers ?? []).map((d) => d.name).filter(Boolean);
    publishers = (details?.publishers ?? []).map((p) => p.name).filter(Boolean);
    description = details?.description_raw ?? null;
  } catch {
    // Best-effort — screenshots are still useful without dev/pub info.
  }

  return {
    screenshots: screenshots.length > 0 ? screenshots : undefined,
    developers: developers.length > 0 ? developers : undefined,
    publishers: publishers.length > 0 ? publishers : undefined,
    description: description ?? undefined,
  };
}

// ---- SteamGridDB -----------------------------------------------------------

async function sgdbSearchId(title) {
  const data = await fetchJson(
    `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(title)}`,
    { headers: { Authorization: `Bearer ${SGDB_KEY}` } }
  );
  const results = data?.data ?? [];
  if (results.length === 0) return null;
  const key = title.toLowerCase();
  const exact = results.find((g) => g.name.toLowerCase() === key);
  return (exact ?? results[0]).id;
}

async function sgdbAsset(url) {
  const data = await fetchJson(url, {
    headers: { Authorization: `Bearer ${SGDB_KEY}` },
  });
  return data?.data?.[0]?.url ?? null;
}

async function sgdbArtwork(title) {
  const id = await sgdbSearchId(title);
  if (!id) return null;
  const [
    coverImageUrl,
    libraryImageUrl,
    libraryHeroImageUrl,
    logoImageUrl,
    iconUrl,
  ] = await Promise.all([
    sgdbAsset(`${SGDB_BASE}/grids/game/${id}?dimensions=600x900&limit=1`),
    sgdbAsset(`${SGDB_BASE}/grids/game/${id}?dimensions=460x215&limit=1`),
    sgdbAsset(`${SGDB_BASE}/heroes/game/${id}?limit=1`),
    sgdbAsset(`${SGDB_BASE}/logos/game/${id}?limit=1`),
    sgdbAsset(`${SGDB_BASE}/icons/game/${id}?limit=1`),
  ]);
  if (
    !coverImageUrl &&
    !libraryImageUrl &&
    !libraryHeroImageUrl &&
    !logoImageUrl &&
    !iconUrl
  ) {
    return null;
  }
  return {
    coverImageUrl,
    libraryImageUrl,
    libraryHeroImageUrl,
    logoImageUrl,
    iconUrl,
  };
}

/** Cheap icon-only resolve, used to backfill entries generated before icons
 *  were added (avoids re-doing IGDB + the other 4 art calls). */
async function sgdbIconOnly(title) {
  const id = await sgdbSearchId(title);
  if (!id) return null;
  return sgdbAsset(`${SGDB_BASE}/icons/game/${id}?limit=1`);
}

// ---- per-system run --------------------------------------------------------

async function processSystem(system, opts) {
  const folder = SYSTEM_TO_DUMP_FOLDER[system];
  if (!folder) {
    process.stderr.write(`skip ${system}: no dump folder mapped\n`);
    return;
  }
  const srcPath = path.join(DUMP_DIR, folder, "games.json");
  if (!fs.existsSync(srcPath)) {
    process.stderr.write(`skip ${system}: no dump at ${srcPath}\n`);
    return;
  }
  // Dump games.json is a flat array of { title, fileSize, downloadLink, ... } —
  // every row is a base game (no contentType field; updates/DLC live in
  // separate update.json/dlc.json files the metadata generator doesn't need).
  const gamesRows = JSON.parse(fs.readFileSync(srcPath, "utf8"));

  const outPath = path.join(OUT_DIR, `${system}.json`);
  const existing = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : { system, generatedAt: 0, games: {} };
  const games = existing.games ?? {};

  // Distinct base-game titles (dedup by normalized key so the merged
  // gb_gba_gbc folder doesn't triple-emit a game that ships under all three
  // consoles — the meta file is per-EmulatorSystem, so gb.json/gbc.json/gba.json
  // each get their own copy of the same entry, which is correct since the
  // runtime lookups are per-system too).
  const titles = [];
  const seen = new Set();
  for (const row of gamesRows) {
    if (!row?.title) continue;
    const key = normalizeTitle(row.title);
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(row.title);
  }

  const platformId = IGDB_PLATFORM_IDS[system];
  const todo = opts.limit ? titles.slice(0, opts.limit) : titles;
  let processed = 0;
  let resolved = 0;

  for (const title of todo) {
    const key = normalizeTitle(title);
    const existing = games[key];

    if (!opts.force && existing) {
      let didWork = false;
      const backfills = [];

      // Icon backfill if this entry predates icons (cheap: 1 SGDB search + 1
      // icon fetch).
      if (!("iconUrl" in existing)) {
        await waitForRamIfNeeded();
        const search = cleanTitle(title) || title;
        existing.iconUrl = await sgdbIconOnly(search).catch(() => null);
        backfills.push(existing.iconUrl ? "icon" : "icon-miss");
        didWork = true;
      }

      // IGDB backfill: re-resolve IGDB with the improved resolver. In
      // --igdb-revalidate mode every entry is re-checked and its IGDB fields
      // overwritten (set null on miss) to scrub wrong matches from the old
      // substring resolver; otherwise only entries missing a description are
      // filled. Either way the 5 art calls are skipped (one IGDB request each).
      if (opts.igdbBackfill && (opts.revalidate || !existing.description)) {
        await waitForRamIfNeeded();
        const igdb = await igdbSearch(igdbTitle(title), platformId).catch(
          () => null
        );
        if (opts.revalidate) {
          existing.description = igdb?.summary ?? null;
          existing.genres = (igdb?.genres ?? []).map((g) => g.name);
          existing.releaseYear = igdb?.first_release_date
            ? new Date(igdb.first_release_date * 1000).getUTCFullYear()
            : null;
        } else if (igdb) {
          existing.description = igdb.summary ?? existing.description ?? null;
          existing.genres = (igdb.genres ?? []).map((g) => g.name);
          existing.releaseYear = igdb.first_release_date
            ? new Date(igdb.first_release_date * 1000).getUTCFullYear()
            : (existing.releaseYear ?? null);
        }
        backfills.push(
          igdb ? `igdb(${(igdb.genres ?? []).length}g)` : "igdb-miss"
        );
        didWork = true;
      }

      if (didWork) {
        resolved++;
        process.stdout.write(
          `  ${system} ${processed + 1}/${todo.length}  "${title}" → backfill (${backfills.join(", ")})\n`
        );
      } else {
        process.stdout.write(
          `  ${system} ${processed + 1}/${todo.length}  "${title}" → skip (cached)\n`
        );
      }
      processed++;
      if (processed % 25 === 0) {
        flush(outPath, { system, generatedAt: Date.now(), games });
      }
      await sleep(opts.igdbBackfill ? 280 : 120);
      continue;
    }

    process.stdout.write(
      `  ${system} ${processed + 1}/${todo.length}  "${title}" fetching...\n`
    );
    // Check available RAM before each network fetch — if the VPS is under
    // memory pressure (other scrapers, Playwright/Chrome), pause until it
    // recovers so we don't get OOM-killed mid-run.
    await waitForRamIfNeeded();
    const [art, igdb, rawg] = await Promise.all([
      sgdbArtwork(cleanTitle(title) || title).catch(() => null),
      igdbSearch(igdbTitle(title), platformId).catch(() => null),
      rawgSearch(cleanTitle(title) || title, system).catch(() => null),
    ]);

    if (art || igdb || rawg) {
      games[key] = {
        title,
        description: igdb?.summary ?? rawg?.description ?? null,
        genres: (igdb?.genres ?? []).map((g) => g.name),
        releaseYear: igdb?.first_release_date
          ? new Date(igdb.first_release_date * 1000).getUTCFullYear()
          : null,
        coverImageUrl: art?.coverImageUrl ?? null,
        libraryImageUrl: art?.libraryImageUrl ?? null,
        libraryHeroImageUrl: art?.libraryHeroImageUrl ?? null,
        logoImageUrl: art?.logoImageUrl ?? null,
        iconUrl: art?.iconUrl ?? null,
        screenshots: rawg?.screenshots ?? undefined,
        developers: rawg?.developers ?? undefined,
        publishers: rawg?.publishers ?? undefined,
      };
      resolved++;
      const artParts = [];
      if (art?.coverImageUrl) artParts.push("cover");
      if (art?.libraryHeroImageUrl) artParts.push("hero");
      if (art?.logoImageUrl) artParts.push("logo");
      if (art?.iconUrl) artParts.push("icon");
      const igdbParts = [];
      if (igdb?.summary) igdbParts.push("desc");
      if (igdb?.genres?.length) igdbParts.push(`${igdb.genres.length}g`);
      if (igdb?.first_release_date)
        igdbParts.push(
          new Date(igdb.first_release_date * 1000).getUTCFullYear()
        );
      const rawgParts = [];
      if (rawg?.screenshots?.length)
        rawgParts.push(`${rawg.screenshots.length}ss`);
      if (rawg?.developers?.length) rawgParts.push("dev");
      if (rawg?.publishers?.length) rawgParts.push("pub");
      const tag =
        [
          artParts.length ? `art(${artParts.join(",")})` : null,
          igdbParts.length ? `igdb(${igdbParts.join(",")})` : null,
          rawgParts.length ? `rawg(${rawgParts.join(",")})` : null,
        ]
          .filter(Boolean)
          .join(" + ") || "partial";
      process.stdout.write(
        `  ${system} ${processed + 1}/${todo.length}  "${title}" → ${tag}\n`
      );
    } else {
      process.stdout.write(
        `  ${system} ${processed + 1}/${todo.length}  "${title}" → MISS (no art, no IGDB, no RAWG)\n`
      );
    }

    processed++;
    if (processed % 25 === 0) {
      // Periodic flush so a long run is crash-safe.
      flush(outPath, { system, generatedAt: Date.now(), games });
    }
    // IGDB allows ~4 req/s; stay well under.
    await sleep(280);
  }

  flush(outPath, { system, generatedAt: Date.now(), games });
  process.stdout.write(
    `done ${system}: ${Object.keys(games).length} total, ${resolved} new this run (${todo.length - resolved} skipped/missed)\n`
  );
}

function flush(outPath, data) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 0));
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const revalidate = args.includes("--igdb-revalidate");
  const igdbBackfill = args.includes("--igdb-backfill") || revalidate;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const systems = args.filter(
    (a, i) => ALL_SYSTEMS.includes(a) && !(limitIdx >= 0 && i === limitIdx + 1)
  );
  const targets = systems.length ? systems : ALL_SYSTEMS;

  process.stdout.write(
    `Generating metadata for: ${targets.join(", ")}${limit ? ` (limit ${limit}/system)` : ""}\n`
  );

  // Load the checkpoint so a crash/resume skips already-completed systems
  // entirely (instead of re-reading games.json + re-checking every cached entry).
  const completed = loadCheckpoint();
  if (completed.size > 0 && !force) {
    process.stdout.write(
      `Checkpoint: ${completed.size} system(s) already completed (${[...completed].join(", ")})\n`
    );
  }

  for (const system of targets) {
    // Skip systems already completed in a prior run (checkpoint). --force
    // ignores the checkpoint so a full re-resolve is still possible.
    if (!force && completed.has(system)) {
      process.stdout.write(`skip ${system}: already completed (checkpoint)\n`);
      continue;
    }
    await processSystem(system, { force, limit, igdbBackfill, revalidate });
    // Per-platform checkpoint save — even if the process crashes later,
    // we know this system's output file is complete and can be skipped.
    completed.add(system);
    saveCheckpoint([...completed]);
  }
  process.stdout.write("All done.\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack || err}\n`);
  process.exit(1);
});
