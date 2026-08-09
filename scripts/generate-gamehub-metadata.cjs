#!/usr/bin/env node
/**
 * GameHub console metadata generator (offline, run-once / periodic).
 *
 * Walks the GameHub Vault dump (Dump/<console>/games.json — the brothers' USA
 * game dumps) and, for every base game, resolves:
 *   - SteamGridDB artwork (cover / wide grid / hero / logo / icon)
 *   - IGDB metadata (description, genres, release year)
 *   - IGN metadata (screenshots, devs/pubs, age rating, review score, series)
 *   - LaunchBox Games DB (curated description/Overview, 3-D box render, true
 *     gameplay screenshots, ESRB rating; romhacks excluded via <ReleaseType>)
 *   - HowLongToBeat (main / main+extras / completionist playtimes)
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
 *   Dump/gb/games.json         → gb   (GB/GBC/GBA are now separate folders,
 *   Dump/gbc/games.json        → gbc   each carrying its true console, rather
 *   Dump/gba/games.json        → gba   than one merged gb_gba_gbc folder)
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
 *             wiiu wii gc switch   (default: all)
 *   --force   re-resolve titles already present in the output (default: skip)
 *   --limit N only process the first N titles per system (smoke testing)
 *
 * Backfill modes (update cached entries in place, cheaper than --force):
 *   --igdb-backfill / --igdb-revalidate   re-run IGDB only
 *   --ign-backfill                        overwrite IGN-sourced fields
 *   --launchbox-backfill                  fill/upgrade from the LaunchBox index
 *   --launchbox-refresh                   force re-download of Metadata.zip
 *   --hltb-backfill                       fill/overwrite HowLongToBeat playtimes
 *   --hltb-probe                          diagnose the live HLTB endpoint, exit
 *
 * HLTB has no stable API (it rotates its endpoint word and, since the 2026 Ziff
 * revamp, serves its frontend from a cross-origin "pogo" bundle). The generator
 * auto-discovers a working /api search endpoint from the site's scripts and
 * probes candidates until one returns data. If HLTB changes again: run
 * `--hltb-probe` to see what's live, then pin it with env HLTB_SEARCH_URL=<url>.
 *
 * The LaunchBox index is built once from the daily Metadata.zip and cached in
 * LAUNCHBOX_CACHE_DIR (default: <tmp>/gamehub-launchbox); it needs the system
 * `unzip`. Fresh/full runs and --launchbox-backfill both build it on demand.
 *
 * Resumable: existing output entries are preserved and skipped unless --force.
 * Rate-limited and retrying so a long full run survives transient 429s.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// ---- credentials (same embedded keys the app ships with) -------------------
const SGDB_KEY = process.env.SGDB_API_KEY || "a41b22e5f9b93f698ff15cf05892aed6";
const IGDB_CLIENT_ID =
  process.env.IGDB_CLIENT_ID || "lbccfxg1ie3739dubo4bvlj7bw0sue";
const IGDB_CLIENT_SECRET =
  process.env.IGDB_CLIENT_SECRET || "e88mbm5snb40ax0n37jpyhearwfikp";
const SGDB_BASE = "https://www.steamgriddb.com/api/v2";

// IGN's public GraphQL (mollusk) — Apollo Automatic Persisted Queries, the same
// endpoint the IGN web client (kraken) uses. Replaces RAWG as the source of
// screenshots, developers/publishers, description, genres, AGE RATING and the
// review score — RAWG's console data was sparse and often mismatched. The
// hashes are the operation ids IGN's client ships; they only change when IGN
// publishes a new query (re-capture from the site's network tab if a call
// starts returning PersistedQueryNotFound).
const IGN_GQL = "https://mollusk.apis.ign.com/graphql";
const IGN_HEADERS = {
  "apollographql-client-name": "kraken",
  "apollographql-client-version": "v0.67.0",
  Referer: "https://www.ign.com/reviews/games",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const IGN_HASH = {
  search: "e1c2e012a21b4a98aaa618ef1b43eb0cafe9136303274a34f5d9ea4f2446e884",
  get: "b9c48f45a7390ecd157229419dc9a2acb48de90c0f255b667076befb38338de6",
  images: "06204b0f0871f8382e3adab7d1c59399e6c17ac94bff575c20a12ebf9d880b86",
};

const DUMP_DIR = path.join(__dirname, "..", "Dump");
const OUT_DIR = path.join(__dirname, "..", "sources", "gamehub-meta");
/** Checkpoint file tracking completed systems so a crash/resume skips them
 *  entirely instead of re-reading games.json + re-checking every cached entry. */
const CHECKPOINT_FILE = path.join(OUT_DIR, ".checkpoint.json");

/**
 * EmulatorSystem → Dump folder. Reverse of CONSOLE_MAP in
 * src/main/services/rom-sources/gamehub-dump-sources.ts. GB/GBC/GBA are now
 * separate folders (each carries its true console) rather than one merged
 * gb_gba_gbc folder.
 */
const SYSTEM_TO_DUMP_FOLDER = {
  n3ds: "3ds",
  nds: "ds",
  gc: "gamecube",
  gb: "gb",
  gbc: "gbc",
  gba: "gba",
  n64: "n64",
  ps1: "ps1",
  ps2: "ps2",
  ps3: "ps3",
  psp: "psp",
  switch: "switch",
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
  switch: 130,
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

// ---- graceful shutdown ------------------------------------------------------
let _shuttingDown = false;
let _currentOutPath = null;
let _currentData = null;

function _setupGracefulShutdown() {
  const saveAndExit = (signal) => {
    if (_shuttingDown) return;
    _shuttingDown = true;
    process.stderr.write(`\n${signal} received — saving state…\n`);
    if (_currentOutPath && _currentData) {
      try {
        flush(_currentOutPath, _currentData);
        process.stderr.write(`  saved ${_currentOutPath}\n`);
      } catch (err) {
        process.stderr.write(`  flush failed: ${err}\n`);
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", () => saveAndExit("SIGINT"));
  process.on("SIGTERM", () => saveAndExit("SIGTERM"));
}

// ---- progress tracking -----------------------------------------------------
let _progressStart = Date.now();
let _progressTotal = 0;
let _progressDone = 0;

function _progressInit(total) {
  _progressTotal = total;
  _progressDone = 0;
  _progressStart = Date.now();
}

function _progressTick() {
  _progressDone++;
  if (_progressDone % 50 === 0 || _progressDone === _progressTotal) {
    const elapsed = (Date.now() - _progressStart) / 1000;
    const rate = _progressDone / elapsed;
    const remaining = (_progressTotal - _progressDone) / rate;
    const eta = Math.ceil(remaining / 60);
    process.stdout.write(
      `  ⏱  ${_progressDone}/${_progressTotal} (${Math.round((100 * _progressDone) / _progressTotal)}%) — ~${eta}m remaining\n`
    );
  }
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
  for (;;) {
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

// ---- IGN (screenshots, devs/pubs, description, age rating, review score) ----

/** Build an IGN mollusk Automatic-Persisted-Query GET URL. */
function ignUrl(operationName, variables, hash) {
  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: hash },
    }),
  });
  return `${IGN_GQL}?${params.toString()}`;
}

async function ignGql(operationName, variables, hash) {
  const data = await fetchJson(ignUrl(operationName, variables, hash), {
    headers: IGN_HEADERS,
  });
  return data?.data ?? null;
}

/** Resolve a title to its IGN game slug via the search operation. Returns null
 *  when nothing plausibly matches (guards against wrong-game screenshots). */
async function ignSearch(title) {
  const data = await ignGql(
    "SearchObjectsByName",
    { term: title, count: 20, objectType: "Game" },
    IGN_HASH.search
  );
  const objects = data?.searchObjectsByName?.objects ?? [];
  if (objects.length === 0) return null;

  const target = normalizeTitle(title);
  const tTokens = tokenize(title);
  let best = null;
  let bestScore = Infinity;
  for (const o of objects) {
    const name = o?.metadata?.names?.name || o?.metadata?.names?.short || "";
    if (!o?.slug || !name) continue;
    const score =
      normalizeTitle(name) === target
        ? 0
        : tokenSymDiff(tokenize(name), tTokens);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  // Require a close match — a large token symmetric-difference means IGN
  // returned a different game, and a wrong screenshot set is worse than none.
  if (!best || bestScore > 2) return null;
  return { slug: best.slug, id: best.id ?? null };
}

/** Full game object (devs/pubs/genres/description/age rating/review/release). */
async function ignGet(slug) {
  const data = await ignGql(
    "ObjectSelectByTypeAndSlug",
    { slug, objectType: "Game", region: "us", state: "Published" },
    IGN_HASH.get
  );
  return data?.objectSelectByTypeAndSlug ?? null;
}

/** Screenshot gallery URLs for a slug. */
async function ignImages(slug) {
  const data = await ignGql(
    "ObjectImageGallery",
    { slug, objectType: "Game", count: 10 },
    IGN_HASH.images
  );
  const images = data?.objectSelectByTypeAndSlug?.imageGallery?.images ?? [];
  return images.map((i) => i?.url).filter(Boolean);
}

/**
 * Fetch IGN metadata for a title: resolve the slug, then pull the game object +
 * image gallery. Returns the fields we store (undefined when absent), or null
 * when the game isn't on IGN / doesn't match.
 */
async function ignFetch(title) {
  const match = await ignSearch(title);
  if (!match?.slug) return null;

  const [game, gallery] = await Promise.all([
    ignGet(match.slug).catch(() => null),
    ignImages(match.slug).catch(() => []),
  ]);
  if (!game && gallery.length === 0) return null;

  const names = (arr) => (arr ?? []).map((a) => a?.name).filter(Boolean);
  const region = (game?.objectRegions ?? [])[0] ?? null;
  const ageRating = region?.ageRating?.name
    ? {
        name: region.ageRating.name,
        system: region.ageRating.ageRatingType ?? null,
      }
    : undefined;
  const releaseDate = region?.releases?.[0]?.date ?? null;
  const primaryImage = game?.primaryImage?.url ?? null;
  const screenshots = (
    gallery.length ? gallery : primaryImage ? [primaryImage] : []
  ).slice(0, 10);
  const developers = names(game?.producers);
  const publishers = names(game?.publishers);
  const genres = names(game?.genres);
  const series = names(game?.franchises)[0];
  const description =
    game?.metadata?.descriptions?.long ||
    game?.metadata?.descriptions?.short ||
    undefined;
  const score = game?.primaryReview?.score;

  return {
    screenshots: screenshots.length ? screenshots : undefined,
    developers: developers.length ? developers : undefined,
    publishers: publishers.length ? publishers : undefined,
    description: description || undefined,
    genres: genres.length ? genres : undefined,
    series: series || undefined,
    ageRating,
    ratingScore: typeof score === "number" ? Math.round(score * 10) : undefined,
    releaseYear: releaseDate
      ? Number(String(releaseDate).slice(0, 4)) || undefined
      : undefined,
  };
}

// ---- LaunchBox Games Database (descriptions, 3-D boxes, gameplay shots) -----
//
// LaunchBox publishes a single daily Metadata.zip (≈300 MB) whose Metadata.xml
// (≈1.5 GB uncompressed) is a flat list of <Game>, <GameAlternateName> and
// <GameImage> records. It's the best free source of curated game *descriptions*
// (Overview), 3-D box renders and true *gameplay* screenshots, and it tags
// fan-made romhacks via <ReleaseType> so we can exclude them. Keyless.
//
// We parse it once (streaming, memory-bounded) into a compact per-system index
// cached OUTSIDE the repo, then look games up by the same normalized title the
// rest of the generator uses.

const LAUNCHBOX_META_ZIP_URL =
  process.env.LAUNCHBOX_META_ZIP_URL ||
  "https://gamesdb.launchbox-app.com/Metadata.zip";
/** Every Games-DB image resolves as `${base}/${GameImage.FileName}`, where
 *  FileName is a bare GUID (e.g. "340d97ea-….png"). Confirmed against the live
 *  database (images.launchbox-app.com serves the full-size art at the root). */
const LAUNCHBOX_IMG_BASE = "https://images.launchbox-app.com";
/** Where the (large) Metadata.zip/.xml and the compact per-system indexes live.
 *  Kept out of the repo tree by default so 1.5 GB never gets committed. */
const LAUNCHBOX_CACHE_DIR =
  process.env.LAUNCHBOX_CACHE_DIR ||
  path.join(os.tmpdir(), "gamehub-launchbox");

/** EmulatorSystem → the LaunchBox <Platform> name(s). Compared normalized, so
 *  case/punctuation ("Sony Playstation" vs "Sony PlayStation") don't matter. */
const LAUNCHBOX_PLATFORMS = {
  gb: ["Nintendo Game Boy"],
  gbc: ["Nintendo Game Boy Color"],
  gba: ["Nintendo Game Boy Advance"],
  n64: ["Nintendo 64"],
  nds: ["Nintendo DS"],
  n3ds: ["Nintendo 3DS"],
  gc: ["Nintendo GameCube"],
  wii: ["Nintendo Wii"],
  wiiu: ["Nintendo Wii U"],
  switch: ["Nintendo Switch"],
  ps1: ["Sony Playstation"],
  ps2: ["Sony Playstation 2"],
  ps3: ["Sony Playstation 3"],
  psp: ["Sony PSP"],
};

/** Normalized LaunchBox platform name → systems that want it (reverse map, for
 *  the single-pass platform filter). */
const LAUNCHBOX_PLATFORM_TO_SYSTEMS = (() => {
  const map = new Map();
  for (const [system, names] of Object.entries(LAUNCHBOX_PLATFORMS)) {
    for (const n of names) {
      const key = normalizeTitle(n);
      const list = map.get(key) ?? [];
      list.push(system);
      map.set(key, list);
    }
  }
  return map;
})();

/** <ReleaseType> values we treat as "the real, retail release". Everything else
 *  (Hack, Homebrew, Prototype, Beta, Bootleg, Pirate, Unlicensed, …) is skipped
 *  so we never attach a romhack's art/overview to a legit game. Blank is the
 *  common case for retail titles, so it's allowed. */
function isAllowedReleaseType(rt) {
  if (!rt) return true;
  return /^(released|retail)$/i.test(rt.trim());
}

/** Decode the handful of XML entities LaunchBox uses and unwrap CDATA. */
function decodeXml(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&amp;/g, "&"); // must be last
}

// Compiled per-tag field regexes reused across the (millions of) records so the
// streaming parse doesn't recompile a RegExp per field per record.
const _fieldRe = new Map();
function fieldRe(tag) {
  let re = _fieldRe.get(tag);
  if (!re) {
    re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
    _fieldRe.set(tag, re);
  }
  return re;
}
/** Pull one child element's text from a record's inner XML. */
function xmlField(inner, tag) {
  const m = inner.match(fieldRe(tag));
  return m ? decodeXml(m[1]).trim() : "";
}

/** LaunchBox stores multi-values as ";"-separated strings. */
function splitList(s) {
  return (s || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Prefer USA/World art, then Japan, then Europe, then anything. Lower = better. */
function regionRank(region) {
  const r = (region || "").toLowerCase();
  if (
    !r ||
    r.includes("north america") ||
    r.includes("united states") ||
    r === "usa" ||
    r.includes("world")
  ) {
    return 0;
  }
  if (r.includes("japan") || r.includes("asia")) return 1;
  if (r.includes("europe")) return 2;
  return 3;
}

/** Build a full Games-DB image URL from a GameImage FileName (bare GUID). */
function launchboxImageUrl(fileName) {
  const f = (fileName || "").trim();
  return f ? `${LAUNCHBOX_IMG_BASE}/${f}` : null;
}

/** Map a LaunchBox ESRB string ("M - Mature") to our {name, system} shape. */
function parseEsrb(esrb) {
  const v = (esrb || "").trim();
  if (!v || /not\s*rated|rating\s*pending|^rp\b/i.test(v)) return undefined;
  const code = v.split(/\s*-\s*/)[0].trim();
  return code ? { name: code, system: "ESRB" } : undefined;
}

/** Reduce a game's raw image list to the art we keep, region-ranked. */
function pickLaunchboxImages(images) {
  const best = (types) => {
    const cands = images
      .filter((i) => types.includes(i.type))
      .sort(
        (a, b) =>
          types.indexOf(a.type) - types.indexOf(b.type) ||
          regionRank(a.region) - regionRank(b.region)
      );
    return cands.length ? cands[0].url : null;
  };
  const screenshots = images
    .filter(
      (i) =>
        i.type === "Screenshot - Gameplay" ||
        i.type === "Screenshot - Game Title"
    )
    .sort(
      (a, b) =>
        (a.type === "Screenshot - Gameplay" ? 0 : 1) -
          (b.type === "Screenshot - Gameplay" ? 0 : 1) ||
        regionRank(a.region) - regionRank(b.region)
    )
    .map((i) => i.url);
  return {
    box3d: best(["Box - 3D"]),
    boxFront: best([
      "Box - Front",
      "Box - Front - Reconstructed",
      "Fanart - Box - Front",
    ]),
    clearLogo: best(["Clear Logo"]),
    fanart: best(["Fanart - Background"]),
    screenshots: [...new Set(screenshots)].slice(0, 6),
  };
}

/**
 * Stream a (multi-GB) XML file and invoke `onElement(tag, inner)` for every
 * top-level record whose tag is in `wantedTags`, holding only a small sliding
 * buffer in memory. LaunchBox's records don't nest, so an open-tag → close-tag
 * scan is exact.
 */
async function streamLaunchboxXml(xmlPath, wantedTags, onElement) {
  const stream = fs.createReadStream(xmlPath, {
    encoding: "utf8",
    highWaterMark: 1 << 20,
  });
  let buf = "";
  for await (const chunk of stream) {
    buf += chunk;
    for (;;) {
      // Earliest opening tag of any wanted element.
      let bestIdx = -1;
      let bestTag = null;
      for (const tag of wantedTags) {
        const i = buf.indexOf(`<${tag}>`);
        if (i !== -1 && (bestIdx === -1 || i < bestIdx)) {
          bestIdx = i;
          bestTag = tag;
        }
      }
      if (bestIdx === -1) {
        // No wanted opening tag yet. Keep a short tail in case one is split
        // across the chunk boundary; drop the rest to bound memory.
        if (buf.length > 64) buf = buf.slice(-64);
        break;
      }
      const close = `</${bestTag}>`;
      const closeIdx = buf.indexOf(close, bestIdx);
      if (closeIdx === -1) {
        // Record continues in the next chunk; discard everything before it.
        if (bestIdx > 0) buf = buf.slice(bestIdx);
        break;
      }
      const inner = buf.slice(bestIdx + bestTag.length + 2, closeIdx);
      onElement(bestTag, inner);
      buf = buf.slice(closeIdx + close.length);
    }
  }
}

/** Download Metadata.zip (streamed to disk) and extract Metadata.xml, caching
 *  both. Returns the Metadata.xml path, or null on failure. */
async function ensureLaunchboxXml(opts) {
  fs.mkdirSync(LAUNCHBOX_CACHE_DIR, { recursive: true });
  const zipPath = path.join(LAUNCHBOX_CACHE_DIR, "Metadata.zip");
  const xmlPath = path.join(LAUNCHBOX_CACHE_DIR, "Metadata.xml");
  if (
    !opts.refresh &&
    fs.existsSync(xmlPath) &&
    fs.statSync(xmlPath).size > 0
  ) {
    return xmlPath;
  }
  if (
    opts.refresh ||
    !fs.existsSync(zipPath) ||
    fs.statSync(zipPath).size === 0
  ) {
    process.stdout.write(
      `  launchbox: downloading ${LAUNCHBOX_META_ZIP_URL} …\n`
    );
    const res = await fetch(LAUNCHBOX_META_ZIP_URL).catch(() => null);
    if (!res?.ok || !res.body) {
      process.stderr.write(
        `  launchbox: download failed (HTTP ${res ? res.status : "network"})\n`
      );
      return null;
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipPath));
  }
  // Extract just Metadata.xml with the system `unzip` (avoids a zip dependency;
  // install with `apt-get install -y unzip` if it's missing on the host).
  process.stdout.write(`  launchbox: extracting Metadata.xml …\n`);
  try {
    execFileSync(
      "unzip",
      ["-o", zipPath, "Metadata.xml", "-d", LAUNCHBOX_CACHE_DIR],
      { stdio: "ignore" }
    );
  } catch (err) {
    process.stderr.write(
      `  launchbox: unzip failed (${err.message}). Install unzip (apt-get install -y unzip).\n`
    );
    return null;
  }
  return fs.existsSync(xmlPath) ? xmlPath : null;
}

/** Build the per-system LaunchBox index from Metadata.xml (two streaming passes:
 *  games+alt-names, then images for matched games) and write compact caches. */
async function buildLaunchboxCaches(systems, xmlPath) {
  const gamesById = new Map(); // dbid -> record
  const nameToId = new Map(); // system -> Map(normname -> dbid)
  for (const s of systems) nameToId.set(s, new Map());

  const addName = (system, normname, dbid, isPrimary) => {
    const m = nameToId.get(system);
    if (m && (isPrimary || !m.has(normname))) m.set(normname, dbid);
  };

  // Pass A — wanted games (right platform + retail release type) + alt names.
  await streamLaunchboxXml(
    xmlPath,
    ["Game", "GameAlternateName"],
    (tag, inner) => {
      if (tag === "Game") {
        const platform = xmlField(inner, "Platform");
        const forSystems = LAUNCHBOX_PLATFORM_TO_SYSTEMS.get(
          normalizeTitle(platform)
        );
        if (!forSystems) return;
        if (!isAllowedReleaseType(xmlField(inner, "ReleaseType"))) return;
        const dbid = xmlField(inner, "DatabaseID");
        const name = xmlField(inner, "Name");
        if (!dbid || !name) return;
        const yearRaw = xmlField(inner, "ReleaseYear");
        gamesById.set(dbid, {
          system: forSystems,
          name,
          overview: xmlField(inner, "Overview") || null,
          developers: splitList(xmlField(inner, "Developer")),
          publishers: splitList(xmlField(inner, "Publisher")),
          genres: splitList(xmlField(inner, "Genres")),
          releaseYear: yearRaw ? Number(yearRaw) || null : null,
          esrb: parseEsrb(xmlField(inner, "ESRB")),
          images: null,
        });
        const nn = normalizeTitle(name);
        for (const sys of forSystems) addName(sys, nn, dbid, true);
      } else {
        // GameAlternateName — extra normnames pointing at the same game (a
        // primary name always wins, so this only fills gaps).
        const dbid = xmlField(inner, "DatabaseID");
        const alt = xmlField(inner, "AlternateName");
        if (!dbid || !alt) return;
        const rec = gamesById.get(dbid);
        if (!rec) return;
        const nn = normalizeTitle(alt);
        for (const sys of rec.system) addName(sys, nn, dbid, false);
      }
    }
  );

  // Pass B — images, but only for games we matched in pass A.
  const imagesById = new Map();
  await streamLaunchboxXml(xmlPath, ["GameImage"], (_tag, inner) => {
    const dbid = xmlField(inner, "DatabaseID");
    if (!dbid || !gamesById.has(dbid)) return;
    const url = launchboxImageUrl(xmlField(inner, "FileName"));
    if (!url) return;
    const list = imagesById.get(dbid) ?? [];
    list.push({
      type: xmlField(inner, "Type"),
      region: xmlField(inner, "Region"),
      url,
    });
    imagesById.set(dbid, list);
  });

  for (const [dbid, rec] of gamesById) {
    rec.images = pickLaunchboxImages(imagesById.get(dbid) ?? []);
  }

  // One compact cache file per system (small — just the matched games).
  fs.mkdirSync(LAUNCHBOX_CACHE_DIR, { recursive: true });
  for (const system of systems) {
    const games = {};
    for (const [normname, dbid] of nameToId.get(system)) {
      const rec = gamesById.get(dbid);
      if (!rec) continue;
      games[normname] = {
        name: rec.name,
        overview: rec.overview,
        developers: rec.developers,
        publishers: rec.publishers,
        genres: rec.genres,
        releaseYear: rec.releaseYear,
        esrb: rec.esrb,
        ...rec.images, // box3d, boxFront, clearLogo, fanart, screenshots
      };
    }
    fs.writeFileSync(
      path.join(LAUNCHBOX_CACHE_DIR, `${system}.json`),
      JSON.stringify({ system, generatedAt: Date.now(), games })
    );
    process.stdout.write(
      `  launchbox: cached ${Object.keys(games).length} ${system} games\n`
    );
  }
}

/** Ensure every requested system has a LaunchBox cache; (re)build from
 *  Metadata.xml if any is missing. Returns false when LaunchBox is unavailable
 *  (the run then simply proceeds without LaunchBox enrichment). */
async function ensureLaunchboxCaches(systems, opts) {
  const supported = systems.filter((s) => LAUNCHBOX_PLATFORMS[s]);
  if (supported.length === 0) return false;
  const missing = opts.refresh
    ? supported
    : supported.filter(
        (s) => !fs.existsSync(path.join(LAUNCHBOX_CACHE_DIR, `${s}.json`))
      );
  if (missing.length === 0) return true;
  const xmlPath = await ensureLaunchboxXml(opts);
  if (!xmlPath) return false;
  process.stdout.write(
    `  launchbox: parsing Metadata.xml for ${supported.join(", ")} (one-time) …\n`
  );
  await buildLaunchboxCaches(supported, xmlPath);
  return true;
}

const _launchboxIndexCache = new Map();
/** Load a system's LaunchBox index (normname → art/text), memoized. Returns
 *  null when the cache is absent (LaunchBox disabled / unavailable). */
function loadLaunchboxIndex(system) {
  if (_launchboxIndexCache.has(system)) return _launchboxIndexCache.get(system);
  let idx = null;
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(LAUNCHBOX_CACHE_DIR, `${system}.json`), "utf8")
    );
    idx = data.games ?? null;
  } catch {
    idx = null;
  }
  _launchboxIndexCache.set(system, idx);
  return idx;
}

/** Look a Dump title up in the system's LaunchBox index (region tags stripped
 *  first so "Game (USA)" matches LaunchBox's "Game"). */
function launchboxLookup(system, title) {
  const idx = loadLaunchboxIndex(system);
  if (!idx) return null;
  return (
    idx[normalizeTitle(cleanTitle(title) || title)] ??
    idx[normalizeTitle(title)] ??
    null
  );
}

/** Merge screenshot sources, LaunchBox first (curated gameplay), deduped, ≤10. */
function mergeScreens(a, b) {
  return [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, 10);
}

/**
 * Union the genre lists from every provider, in priority order, de-duplicated
 * case-insensitively (first spelling wins) and capped. A single provider often
 * under-describes a game — IGDB alone tags e.g. "Breath of the Wild" merely
 * "Puzzle, Adventure" — so combining IGN (the primary source), IGDB and
 * LaunchBox yields the fuller, more accurate genre set the game actually is.
 */
function mergeGenres(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const name = String(raw ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out.slice(0, 5);
}

// ---- HowLongToBeat (main / main+extra / completionist playtimes) ------------
//
// Mirrors the Playnite HowLongToBeat plugin's access path. HLTB has no public
// API and actively fights scrapers: the POST search endpoint word rotates
// (/api/search → /api/seek → /api/bleed …) and recent builds gate it behind a
// per-session auth handshake. So we (1) discover the current endpoint from the
// site's _app-*.js bundle, (2) best-effort fetch its /init auth token + key/val,
// then (3) POST the search with those headers — the same dance the plugin (and
// the maintained howlongtobeat libraries) do. Everything is best-effort: any
// failure just yields no HLTB data for the run, it never blocks it. The
// comp_main/comp_plus/comp_100 response fields are in seconds.

const HLTB_BASE = "https://howlongtobeat.com";
const HLTB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  Referer: `${HLTB_BASE}/`,
  Origin: HLTB_BASE,
};

// Discovered once per run and reused for every title. undefined = not tried yet.
let _hltbSession = undefined;

/** GET text (not JSON) with the browser-like HLTB headers. */
async function hltbText(url) {
  try {
    const res = await fetch(url, { headers: HLTB_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Historical/known search paths, tried after anything found in the JS bundles.
// HLTB rotates this word (search → s → seek → find → ouch → bleed …) and, since
// the 2026 Ziff Davis revamp, moved its frontend to a cross-origin "pogo" bundle
// on cdn.ziffstatic.com — so the endpoint now lives in that bundle, not an
// _app-*.js file. We therefore DISCOVER candidates from every script the page
// loads and TRY each until one returns data, rather than guessing one path.
const HLTB_DEFAULT_ENDPOINTS = [
  "/api/search",
  "/api/s/",
  "/api/seek",
  "/api/find",
  "/api/ouch",
  "/api/bleed",
  "/api/lookup",
  "/api/games",
];

/** Every <script src> the homepage loads, app/pogo/ziffstatic bundles first. */
async function hltbScriptUrls() {
  const html = await hltbText(`${HLTB_BASE}/`);
  if (!html) return [];
  const urls = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(
    (m) => m[1]
  );
  const abs = urls.map((u) =>
    u.startsWith("http") ? u : `${HLTB_BASE}${u.startsWith("/") ? "" : "/"}${u}`
  );
  const rank = (u) =>
    /pogo|ziffstatic/i.test(u)
      ? 0
      : /_app-|app[.-]|main|chunk|index/i.test(u)
        ? 1
        : 2;
  return [...new Set(abs)].sort((a, b) => rank(a) - rank(b));
}

/** Scan the JS bundles for candidate /api/<word> search paths (and any absolute
 *  howlongtobeat.com/api URLs, in case it moved off the apex host). */
async function hltbBundleEndpoints() {
  const found = [];
  const push = (p) => {
    if (p && !found.includes(p)) found.push(p);
  };
  for (const src of (await hltbScriptUrls()).slice(0, 10)) {
    const js = await hltbText(src);
    if (!js) continue;
    for (const m of js.matchAll(
      /["'`]\/api\/([a-zA-Z][a-zA-Z0-9_]*(?:\/[a-zA-Z0-9_]+)*)["'`]/g
    )) {
      push(`/api/${m[1]}`);
    }
    for (const m of js.matchAll(
      /https?:\/\/[a-z0-9.-]*howlongtobeat\.com\/api\/[a-zA-Z0-9_/]+/g
    )) {
      push(m[0]);
    }
    if (found.length) break; // first bundle carrying /api refs is enough
  }
  return found;
}

/** Best-effort auth handshake: GET <searchUrl>/init for { token, *key*, *val* }
 *  (recent HLTB builds require x-auth-token + x-hp-key/x-hp-val on the search). */
async function hltbGetAuth(searchUrl) {
  const data = await fetchJson(`${searchUrl.replace(/\/$/, "")}/init`, {
    headers: HLTB_HEADERS,
  }).catch(() => null);
  if (!data || typeof data !== "object") return null;
  // The init response carries a token plus a key/val pair whose VALUES become
  // both the x-hp-key/x-hp-val headers and a body field: payload[key] = val
  // (mirrors the maintained howlongtobeat clients / the Playnite plugin).
  let token = null;
  let key = null;
  let val = null;
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== "string") continue;
    if (/token/i.test(k) && !token) token = v;
    else if (/key/i.test(k) && key == null) key = v;
    else if (/val/i.test(k) && val == null) val = v;
  }
  if (!token && !key) return null;
  return { token, key, val };
}

/**
 * Resolve a working HLTB search session once per run: gather candidate endpoints
 * (JS bundles first, then the known words), and probe each with a throwaway
 * search until one returns data — that URL + its auth is cached. A hard override
 * (env HLTB_SEARCH_URL) skips discovery entirely. `null` = none worked.
 */
async function ensureHltbSession() {
  if (_hltbSession !== undefined) return _hltbSession;
  const override = process.env.HLTB_SEARCH_URL;
  const candidates = override
    ? [override]
    : [...(await hltbBundleEndpoints()), ...HLTB_DEFAULT_ENDPOINTS];
  const tried = [];
  for (const ep of [...new Set(candidates)]) {
    const url = ep.startsWith("http") ? ep : `${HLTB_BASE}${ep}`;
    const auth = await hltbGetAuth(url).catch(() => null);
    const session = { url, auth };
    const rows = await hltbPost("Mario", session); // throwaway probe
    tried.push(`${ep}${auth ? "+auth" : ""}${rows?.length ? "=OK" : ""}`);
    if (rows && rows.length) {
      _hltbSession = session;
      process.stdout.write(`  hltb: using ${url}${auth ? " (+auth)" : ""}\n`);
      return _hltbSession;
    }
  }
  _hltbSession = null;
  process.stdout.write(
    `  hltb: no working endpoint (tried ${tried.join(", ") || "none"}). ` +
      `Set HLTB_SEARCH_URL to override, or run --hltb-probe to inspect.\n`
  );
  return _hltbSession;
}

/** Build the search request body for a title (the plugin's payload shape). */
function hltbBody(name, auth) {
  const body = {
    searchType: "games",
    searchTerms: name.split(/\s+/).filter(Boolean),
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
        rangeYear: { max: "", min: "" },
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
  if (auth?.key && auth?.val != null) body[auth.key] = auth.val;
  return body;
}

/** POST one search with a session; returns the data array or null. */
async function hltbPost(name, session) {
  const headers = { ...HLTB_HEADERS, "Content-Type": "application/json" };
  if (session.auth?.token) headers["x-auth-token"] = session.auth.token;
  if (session.auth?.key) headers["x-hp-key"] = session.auth.key;
  if (session.auth?.val) headers["x-hp-val"] = session.auth.val;
  const data = await fetchJson(session.url, {
    method: "POST",
    headers,
    body: JSON.stringify(hltbBody(name, session.auth)),
  }).catch(() => null);
  return Array.isArray(data?.data) ? data.data : null;
}

/** Search HLTB and return the best-matching game row, or null. */
async function hltbSearch(title) {
  const session = await ensureHltbSession();
  if (!session) return null;
  const name = cleanTitle(title) || title;
  let rows = await hltbPost(name, session);
  // Nothing back? The token may have rotated mid-run — re-resolve once and retry.
  if (!rows || rows.length === 0) {
    _hltbSession = undefined;
    const fresh = await ensureHltbSession();
    rows = fresh ? await hltbPost(name, fresh) : null;
  }
  if (!rows || rows.length === 0) return null;

  const target = normalizeTitle(name);
  const tTokens = tokenize(name);
  let best = null;
  let bestScore = Infinity;
  for (const r of rows) {
    const rn = r?.game_name || "";
    if (!rn) continue;
    const score =
      normalizeTitle(rn) === target ? 0 : tokenSymDiff(tokenize(rn), tTokens);
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  // Require a close match — a wrong game's playtime is worse than none.
  return best && bestScore <= 2 ? best : null;
}

/** Seconds → hours rounded to the nearest half hour (HLTB's display grain). */
function hltbHours(sec) {
  return typeof sec === "number" && sec > 0
    ? Math.round((sec / 3600) * 2) / 2
    : null;
}

/** Resolve HLTB playtimes: { main, mainExtra, completionist } in hours. */
async function hltbFetch(title) {
  const g = await hltbSearch(title).catch(() => null);
  if (!g) return null;
  const main = hltbHours(g.comp_main);
  const mainExtra = hltbHours(g.comp_plus);
  const completionist = hltbHours(g.comp_100);
  if (main == null && mainExtra == null && completionist == null) return null;
  return { main, mainExtra, completionist };
}

/** Diagnostic (`--hltb-probe`): dump the site's scripts, the /api candidates
 *  found in the bundles, whether a working search endpoint was resolved, and a
 *  sample result. Run this whenever HLTB changes its site again — it shows what
 *  is actually live so the endpoint/shape can be re-mapped (or pinned via
 *  HLTB_SEARCH_URL) without guessing. */
async function hltbProbeReport() {
  process.stdout.write("HLTB probe:\n");
  const scripts = await hltbScriptUrls();
  process.stdout.write(`  homepage scripts (${scripts.length}):\n`);
  for (const s of scripts.slice(0, 25)) process.stdout.write(`    ${s}\n`);
  const eps = await hltbBundleEndpoints();
  process.stdout.write(
    `  /api candidates in bundles: ${eps.length ? eps.join(", ") : "(none found)"}\n`
  );
  const session = await ensureHltbSession();
  if (!session) {
    process.stdout.write("  result: NO working endpoint.\n");
    return;
  }
  process.stdout.write(`  result: WORKING → ${session.url}\n`);
  const rows = await hltbPost("The Legend of Zelda Ocarina of Time", session);
  process.stdout.write(`  sample search rows: ${rows?.length ?? 0}\n`);
  if (rows?.[0]) {
    const r = rows[0];
    process.stdout.write(
      `    top: "${r.game_name}" main=${r.comp_main}s plus=${r.comp_plus}s 100=${r.comp_100}s\n`
    );
  }
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

  // Distinct base-game titles (dedup by normalized key within the folder so a
  // console's meta file has one entry per title).
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

      // IGN backfill: re-fetch IGN for EVERY entry and OVERWRITE the
      // IGN-sourced fields (screenshots/devs/pubs/ageRating/ratingScore/series).
      // This is the migration path off RAWG — cached entries already carry RAWG
      // screenshots/devs/pubs, so a fill-only pass would skip them all and
      // replace nothing. Art (SGDB) + description/genres (IGDB) are left intact,
      // so this is far cheaper than a full --force re-resolve. On an IGN miss
      // the existing values are kept (some data beats none for games not on
      // IGN) — use --force for a hard purge.
      if (opts.ignBackfill) {
        await waitForRamIfNeeded();
        const ign = await ignFetch(cleanTitle(title) || title).catch(
          () => null
        );
        if (ign) {
          if (ign.screenshots?.length) existing.screenshots = ign.screenshots;
          if (ign.developers?.length) existing.developers = ign.developers;
          if (ign.publishers?.length) existing.publishers = ign.publishers;
          if (ign.ageRating) existing.ageRating = ign.ageRating;
          if (typeof ign.ratingScore === "number")
            existing.ratingScore = ign.ratingScore;
          if (ign.series) existing.series = ign.series;
          // Only fill a description when IGDB never provided one.
          if (!existing.description && ign.description)
            existing.description = ign.description;
        }
        backfills.push(
          ign
            ? `ign(${ign.screenshots?.length ?? 0}ss,${
                ign.developers?.length ?? 0
              }dev,${ign.ageRating ? ign.ageRating.name : "-"})`
            : "ign-miss"
        );
        didWork = true;
      }

      // LaunchBox backfill: fill/upgrade the description (LaunchBox Overviews
      // preferred), the 3-D box, gameplay screenshots, clear logo, hero fanart
      // and the ESRB age rating from the cached Games-DB index. Purely local —
      // no network — so it's cheap to run over every cached entry.
      if (opts.launchboxBackfill) {
        const lb = launchboxLookup(system, title);
        if (lb) {
          if (lb.overview) existing.description = lb.overview;
          if (lb.box3d || lb.boxFront)
            existing.boxImageUrl = lb.box3d ?? lb.boxFront;
          if (!existing.coverImageUrl && (lb.box3d || lb.boxFront))
            existing.coverImageUrl = lb.box3d ?? lb.boxFront;
          if (!existing.logoImageUrl && lb.clearLogo)
            existing.logoImageUrl = lb.clearLogo;
          if (!existing.libraryHeroImageUrl && lb.fanart)
            existing.libraryHeroImageUrl = lb.fanart;
          if (lb.screenshots?.length)
            existing.screenshots = mergeScreens(
              lb.screenshots,
              existing.screenshots
            );
          if (!existing.ageRating && lb.esrb) existing.ageRating = lb.esrb;
          if (!existing.developers?.length && lb.developers?.length)
            existing.developers = lb.developers;
          if (!existing.publishers?.length && lb.publishers?.length)
            existing.publishers = lb.publishers;
        }
        backfills.push(
          lb
            ? `lbox(${lb.box3d ? "3d" : lb.boxFront ? "box" : "-"},${
                lb.screenshots?.length ?? 0
              }ss${lb.overview ? ",desc" : ""})`
            : "lbox-miss"
        );
        didWork = true;
      }

      // HowLongToBeat backfill: fill/overwrite the playtimes on a cached entry.
      // One network search per title (endpoint/auth discovered once per run).
      if (opts.hltbBackfill) {
        await waitForRamIfNeeded();
        const hltb = await hltbFetch(cleanTitle(title) || title).catch(
          () => null
        );
        if (hltb) existing.hltb = hltb;
        backfills.push(hltb ? `hltb(${hltb.main ?? "-"}h)` : "hltb-miss");
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
      // In backfill mode, flush after EVERY entry so zero data is lost on crash.
      flush(outPath, { system, generatedAt: Date.now(), games });
      await sleep(
        opts.ignBackfill
          ? 400
          : opts.hltbBackfill
            ? 350
            : opts.igdbBackfill
              ? 280
              : opts.launchboxBackfill
                ? 0
                : 120
      );
      continue;
    }

    process.stdout.write(
      `  ${system} ${processed + 1}/${todo.length}  "${title}" fetching...\n`
    );
    // Check available RAM before each network fetch — if the VPS is under
    // memory pressure (other scrapers, Playwright/Chrome), pause until it
    // recovers so we don't get OOM-killed mid-run.
    await waitForRamIfNeeded();
    const [art, igdb, ign, hltb] = await Promise.all([
      sgdbArtwork(cleanTitle(title) || title).catch(() => null),
      igdbSearch(igdbTitle(title), platformId).catch(() => null),
      ignFetch(cleanTitle(title) || title).catch(() => null),
      hltbFetch(cleanTitle(title) || title).catch(() => null),
    ]);
    // LaunchBox is a local index lookup (no network) — cheap, so no await.
    const lb = launchboxLookup(system, title);

    if (art || igdb || ign || lb || hltb) {
      const igdbGenres = (igdb?.genres ?? []).map((g) => g.name);
      const mergedScreens = mergeScreens(lb?.screenshots, ign?.screenshots);
      games[key] = {
        title,
        // Description preference: LaunchBox Overviews read best for emulated
        // games (user preference), then IGDB, then IGN.
        description: lb?.overview ?? igdb?.summary ?? ign?.description ?? null,
        // Merge genres across providers (IGN first — the primary source — then
        // IGDB, then LaunchBox), de-duplicated and capped, so a game gets its
        // full genre set instead of whatever a single source happened to return
        // (IGDB alone under-tags e.g. Breath of the Wild as "Puzzle, Adventure").
        genres: mergeGenres(ign?.genres, igdbGenres, lb?.genres),
        releaseYear: igdb?.first_release_date
          ? new Date(igdb.first_release_date * 1000).getUTCFullYear()
          : (ign?.releaseYear ?? lb?.releaseYear ?? null),
        // SGDB art is dimensioned for the app's card layout, so it stays
        // primary; LaunchBox 3-D/front box fills a missing cover.
        coverImageUrl: art?.coverImageUrl ?? lb?.box3d ?? lb?.boxFront ?? null,
        libraryImageUrl: art?.libraryImageUrl ?? null,
        libraryHeroImageUrl: art?.libraryHeroImageUrl ?? lb?.fanart ?? null,
        logoImageUrl: art?.logoImageUrl ?? lb?.clearLogo ?? null,
        iconUrl: art?.iconUrl ?? null,
        // LaunchBox 3-D box render for the details "feature" art; falls back to
        // a flat front box so the field is still populated.
        boxImageUrl: lb?.box3d ?? lb?.boxFront ?? undefined,
        // LaunchBox gameplay screenshots first (curated), topped up with IGN's.
        screenshots: mergedScreens.length ? mergedScreens : undefined,
        developers:
          ign?.developers ??
          (lb?.developers?.length ? lb.developers : undefined),
        publishers:
          ign?.publishers ??
          (lb?.publishers?.length ? lb.publishers : undefined),
        // Age rating (drives the settings "hide M-rated" filter): IGN's ESRB/PEGI
        // first, LaunchBox's ESRB as a broad-coverage fallback.
        ageRating: ign?.ageRating ?? lb?.esrb ?? undefined,
        ratingScore: ign?.ratingScore ?? undefined,
        series: ign?.series ?? undefined,
        // HowLongToBeat playtimes (hours): main / main+extras / completionist.
        hltb: hltb ?? undefined,
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
      const ignParts = [];
      if (ign?.screenshots?.length)
        ignParts.push(`${ign.screenshots.length}ss`);
      if (ign?.developers?.length) ignParts.push("dev");
      if (ign?.publishers?.length) ignParts.push("pub");
      if (ign?.ageRating) ignParts.push(ign.ageRating.name);
      if (typeof ign?.ratingScore === "number")
        ignParts.push(`${ign.ratingScore}`);
      const lbParts = [];
      if (lb?.overview) lbParts.push("desc");
      if (lb?.box3d) lbParts.push("3d");
      else if (lb?.boxFront) lbParts.push("box");
      if (lb?.screenshots?.length) lbParts.push(`${lb.screenshots.length}ss`);
      if (lb?.esrb) lbParts.push(lb.esrb.name);
      const hltbParts = [];
      if (hltb?.main != null) hltbParts.push(`${hltb.main}h`);
      else if (hltb?.mainExtra != null) hltbParts.push(`${hltb.mainExtra}h+`);
      else if (hltb?.completionist != null)
        hltbParts.push(`${hltb.completionist}h*`);
      const tag =
        [
          artParts.length ? `art(${artParts.join(",")})` : null,
          igdbParts.length ? `igdb(${igdbParts.join(",")})` : null,
          ignParts.length ? `ign(${ignParts.join(",")})` : null,
          lbParts.length ? `lbox(${lbParts.join(",")})` : null,
          hltbParts.length ? `hltb(${hltbParts.join(",")})` : null,
        ]
          .filter(Boolean)
          .join(" + ") || "partial";
      process.stdout.write(
        `  ${system} ${processed + 1}/${todo.length}  "${title}" → ${tag}\n`
      );
    } else {
      process.stdout.write(
        `  ${system} ${processed + 1}/${todo.length}  "${title}" → MISS (no art, no IGDB, no IGN, no LaunchBox, no HLTB)\n`
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
  const ignBackfill = args.includes("--ign-backfill");
  const launchboxBackfill = args.includes("--launchbox-backfill");
  const launchboxRefresh = args.includes("--launchbox-refresh");
  const hltbBackfill = args.includes("--hltb-backfill");
  const hltbProbe = args.includes("--hltb-probe");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const systems = args.filter(
    (a, i) => ALL_SYSTEMS.includes(a) && !(limitIdx >= 0 && i === limitIdx + 1)
  );
  const targets = systems.length ? systems : ALL_SYSTEMS;

  // Diagnostic-only: inspect what HLTB is serving right now, then exit.
  if (hltbProbe) {
    await hltbProbeReport();
    return;
  }

  process.stdout.write(
    `Generating metadata for: ${targets.join(", ")}${limit ? ` (limit ${limit}/system)` : ""}\n`
  );

  // Build the LaunchBox index once up-front when this run will consume it —
  // i.e. a --launchbox-backfill, or any fresh/full run (the fresh-fetch path
  // calls launchboxLookup). A pure --ign/--igdb backfill skips it (those only
  // touch already-cached entries), so a quick smoke test doesn't pull ~300 MB.
  const usesLaunchbox = launchboxBackfill || (!ignBackfill && !igdbBackfill);
  if (usesLaunchbox) {
    const ok = await ensureLaunchboxCaches(targets, {
      refresh: launchboxRefresh,
    }).catch((err) => {
      process.stderr.write(`launchbox: cache build failed: ${err.message}\n`);
      return false;
    });
    if (!ok) {
      process.stdout.write(
        "launchbox: proceeding without LaunchBox enrichment (cache unavailable)\n"
      );
    }
  }

  // Warm the HLTB session (discover endpoint + auth once) up-front when this run
  // will consume it — a --hltb-backfill, or any fresh/full run (the fresh path
  // calls hltbFetch). Pure ign/igdb/launchbox backfills skip it.
  const usesHltb =
    hltbBackfill || (!ignBackfill && !igdbBackfill && !launchboxBackfill);
  if (usesHltb) await ensureHltbSession().catch(() => null);

  // Load the checkpoint so a crash/resume skips already-completed systems
  // entirely (instead of re-reading games.json + re-checking every cached entry).
  const completed = loadCheckpoint();
  if (completed.size > 0 && !force) {
    process.stdout.write(
      `Checkpoint: ${completed.size} system(s) already completed (${[...completed].join(", ")})\n`
    );
  }

  for (const system of targets) {
    // Skip systems already completed in a prior run (checkpoint). --force and
    // the backfill modes ignore the checkpoint so a re-resolve is still possible.
    if (
      !force &&
      !ignBackfill &&
      !launchboxBackfill &&
      !hltbBackfill &&
      completed.has(system)
    ) {
      process.stdout.write(`skip ${system}: already completed (checkpoint)\n`);
      continue;
    }
    await processSystem(system, {
      force,
      limit,
      igdbBackfill,
      revalidate,
      ignBackfill,
      launchboxBackfill,
      hltbBackfill,
    });
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
