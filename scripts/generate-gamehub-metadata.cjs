#!/usr/bin/env node
/**
 * GameHub console metadata generator (offline, run-once / periodic).
 *
 * Walks the hosted Minerva ROM catalogue (sources/minerva/<system>.json) and,
 * for every base game, resolves:
 *   - SteamGridDB artwork (cover / wide grid / hero / logo)
 *   - IGDB metadata (description, genres, release year)
 * and writes a flat, GitHub-hostable dataset to
 * sources/gamehub-meta/<system>.json keyed by the SAME normalized title the
 * app uses at runtime. The app fetches these files raw from GitHub — no live
 * SGDB/IGDB calls on the user's launch path (those rate-limit and need keys).
 *
 * This is the "GameHubAPI" — a static dataset, not a server.
 *
 * Usage:
 *   node scripts/generate-gamehub-metadata.cjs [systems...] [--force] [--limit N]
 *
 *   systems   one or more of ps1 ps2 ps3 psp n3ds nds dsi n64 gb gbc gba
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

const MINERVA_DIR = path.join(__dirname, "..", "sources", "minerva");
const OUT_DIR = path.join(__dirname, "..", "sources", "gamehub-meta");

const ALL_SYSTEMS = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n3ds",
  "nds",
  "dsi",
  "n64",
  "gb",
  "gbc",
  "gba",
  "wiiu",
  "wii",
  "gc",
];

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

// ---- helpers ---------------------------------------------------------------

/** MUST match normalizeTitle in src/main/level/sublevels/minerva-catalogue.ts. */
function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip edition/region noise to improve IGDB/SGDB match rates. */
function cleanTitle(title) {
  return title
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

async function igdbSearch(title, platformId) {
  const token = await igdbAuth();
  const platformClause = platformId ? ` & platforms = [${platformId}]` : "";
  const query = `fields name,summary,first_release_date,genres.name;
where name ~ *"${title.replace(/"/g, "")}"*${platformClause};
limit 5;`;
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
  const norm = title.toLowerCase();
  // Prefer the closest name match.
  let best = data[0];
  let bestLen = Math.abs(best.name.toLowerCase().length - norm.length);
  for (const g of data) {
    if (g.name.toLowerCase() === norm) return g;
    const len = Math.abs(g.name.toLowerCase().length - norm.length);
    if (len < bestLen) {
      best = g;
      bestLen = len;
    }
  }
  return best;
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
  const srcPath = path.join(MINERVA_DIR, `${system}.json`);
  if (!fs.existsSync(srcPath)) {
    process.stderr.write(`skip ${system}: no minerva source\n`);
    return;
  }
  const source = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const downloads = source.downloads ?? [];

  const outPath = path.join(OUT_DIR, `${system}.json`);
  const existing = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : { system, generatedAt: 0, games: {} };
  const games = existing.games ?? {};

  // Distinct base-game titles (skip updates/DLC).
  const titles = [];
  const seen = new Set();
  for (const d of downloads) {
    if (d.contentType && d.contentType !== "game") continue;
    const key = normalizeTitle(d.title);
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(d.title);
  }

  const platformId = IGDB_PLATFORM_IDS[system];
  const todo = opts.limit ? titles.slice(0, opts.limit) : titles;
  let processed = 0;
  let resolved = 0;

  for (const title of todo) {
    const key = normalizeTitle(title);
    const existing = games[key];

    if (!opts.force && existing) {
      // Already resolved. Backfill just the icon if this entry predates icons
      // (cheap: one SGDB search + one icon fetch, no IGDB / other art).
      if (!("iconUrl" in existing)) {
        const search = cleanTitle(title) || title;
        existing.iconUrl = await sgdbIconOnly(search).catch(() => null);
        resolved++;
        processed++;
        if (processed % 25 === 0) {
          process.stdout.write(
            `  ${system}: ${processed}/${todo.length} (${resolved} backfilled)\n`
          );
          flush(outPath, { system, generatedAt: Date.now(), games });
        }
        await sleep(120);
      } else {
        processed++;
      }
      continue;
    }

    const search = cleanTitle(title) || title;
    const [art, igdb] = await Promise.all([
      sgdbArtwork(search).catch(() => null),
      igdbSearch(search, platformId).catch(() => null),
    ]);

    if (art || igdb) {
      games[key] = {
        title,
        description: igdb?.summary ?? null,
        genres: (igdb?.genres ?? []).map((g) => g.name),
        releaseYear: igdb?.first_release_date
          ? new Date(igdb.first_release_date * 1000).getUTCFullYear()
          : null,
        coverImageUrl: art?.coverImageUrl ?? null,
        libraryImageUrl: art?.libraryImageUrl ?? null,
        libraryHeroImageUrl: art?.libraryHeroImageUrl ?? null,
        logoImageUrl: art?.logoImageUrl ?? null,
        iconUrl: art?.iconUrl ?? null,
      };
      resolved++;
    }

    processed++;
    if (processed % 25 === 0) {
      process.stdout.write(
        `  ${system}: ${processed}/${todo.length} (${resolved} resolved)\n`
      );
      // Periodic flush so a long run is crash-safe.
      flush(outPath, { system, generatedAt: Date.now(), games });
    }
    // IGDB allows ~4 req/s; stay well under.
    await sleep(280);
  }

  flush(outPath, { system, generatedAt: Date.now(), games });
  process.stdout.write(
    `done ${system}: ${Object.keys(games).length} total, ${resolved} new this run\n`
  );
}

function flush(outPath, data) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 0));
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const systems = args.filter(
    (a, i) => ALL_SYSTEMS.includes(a) && !(limitIdx >= 0 && i === limitIdx + 1)
  );
  const targets = systems.length ? systems : ALL_SYSTEMS;

  process.stdout.write(
    `Generating metadata for: ${targets.join(", ")}${limit ? ` (limit ${limit}/system)` : ""}\n`
  );

  for (const system of targets) {
    await processSystem(system, { force, limit });
  }
  process.stdout.write("All done.\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.stack || err}\n`);
  process.exit(1);
});
