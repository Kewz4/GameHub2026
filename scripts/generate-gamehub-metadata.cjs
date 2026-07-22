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

function setupGracefulShutdown() {
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

function progressInit(total) {
  _progressTotal = total;
  _progressDone = 0;
  _progressStart = Date.now();
}

function progressTick() {
  _progressDone++;
  if (_progressDone % 50 === 0 || _progressDone === _progressTotal) {
    const elapsed = (Date.now() - _progressStart) / 1000;
    const rate = _progressDone / elapsed;
    const remaining = (_progressTotal - _progressDone) / rate;
    const eta = Math.ceil(remaining / 60);
    process.stdout.write(
      `  ⏱  ${_progressDone}/${_progressTotal} (${Math.round(100*_progressDone/_progressTotal)}%) — ~${eta}m remaining\n`
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
        const ign = await ignFetch(cleanTitle(title) || title).catch(() => null);
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
      await sleep(opts.ignBackfill ? 400 : opts.igdbBackfill ? 280 : 120);
      continue;
    }

    process.stdout.write(
      `  ${system} ${processed + 1}/${todo.length}  "${title}" fetching...\n`
    );
    // Check available RAM before each network fetch — if the VPS is under
    // memory pressure (other scrapers, Playwright/Chrome), pause until it
    // recovers so we don't get OOM-killed mid-run.
    await waitForRamIfNeeded();
    const [art, igdb, ign] = await Promise.all([
      sgdbArtwork(cleanTitle(title) || title).catch(() => null),
      igdbSearch(igdbTitle(title), platformId).catch(() => null),
      ignFetch(cleanTitle(title) || title).catch(() => null),
    ]);

    if (art || igdb || ign) {
      const igdbGenres = (igdb?.genres ?? []).map((g) => g.name);
      games[key] = {
        title,
        description: igdb?.summary ?? ign?.description ?? null,
        // Prefer IGDB genres; fall back to IGN's when IGDB missed the game.
        genres: igdbGenres.length ? igdbGenres : (ign?.genres ?? []),
        releaseYear: igdb?.first_release_date
          ? new Date(igdb.first_release_date * 1000).getUTCFullYear()
          : (ign?.releaseYear ?? null),
        coverImageUrl: art?.coverImageUrl ?? null,
        libraryImageUrl: art?.libraryImageUrl ?? null,
        libraryHeroImageUrl: art?.libraryHeroImageUrl ?? null,
        logoImageUrl: art?.logoImageUrl ?? null,
        iconUrl: art?.iconUrl ?? null,
        screenshots: ign?.screenshots ?? undefined,
        developers: ign?.developers ?? undefined,
        publishers: ign?.publishers ?? undefined,
        // New IGN-sourced fields: ESRB/PEGI age rating (drives the settings
        // "hide M-rated" filter), the aggregate review score, and the series.
        ageRating: ign?.ageRating ?? undefined,
        ratingScore: ign?.ratingScore ?? undefined,
        series: ign?.series ?? undefined,
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
      const tag =
        [
          artParts.length ? `art(${artParts.join(",")})` : null,
          igdbParts.length ? `igdb(${igdbParts.join(",")})` : null,
          ignParts.length ? `ign(${ignParts.join(",")})` : null,
        ]
          .filter(Boolean)
          .join(" + ") || "partial";
      process.stdout.write(
        `  ${system} ${processed + 1}/${todo.length}  "${title}" → ${tag}\n`
      );
    } else {
      process.stdout.write(
        `  ${system} ${processed + 1}/${todo.length}  "${title}" → MISS (no art, no IGDB, no IGN)\n`
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
    if (!force && !ignBackfill && completed.has(system)) {
      process.stdout.write(`skip ${system}: already completed (checkpoint)\n`);
      continue;
    }
    await processSystem(system, {
      force,
      limit,
      igdbBackfill,
      revalidate,
      ignBackfill,
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
