#!/usr/bin/env node
/* Generate per-platform Minerva source JSON files from hashes.db (SQLite). */
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const DB_PATH = process.argv[2] || "./hashes.db";
const OUT_DIR = process.argv[3] || "./sources/minerva";

/**
 * Platform definitions.
 *
 * `path`     – minerva full_path prefix (matches `.<Category>/<Platform>/` slug)
 * `label`    – human-facing console name used in the "name" field
 * `classify` – how to derive each row's content type:
 *                "game"            → every row is a base game
 *                "update"          → every row is an update
 *                "auto-wiiu"       → classify Wii U CDN rows by their tags
 *                "auto-ps3-content"→ classify PS3 PSN Content rows by filename
 * `outputs`  – map of contentType → output JSON filename. Each content type
 *              that `classify` can produce is written to its own file, so games,
 *              updates and DLC live in separate catalogues.
 */
const PLATFORM_DEFS = [
  {
    path: "No-Intro/Nintendo - Nintendo 3DS (Decrypted)",
    label: "Nintendo 3DS",
    classify: "game",
    outputs: { game: "n3ds.json" },
  },
  {
    path: "No-Intro/Nintendo - Nintendo DS (Decrypted)",
    label: "Nintendo DS",
    classify: "game",
    outputs: { game: "nds.json" },
  },
  {
    path: "No-Intro/Nintendo - Nintendo DSi (Decrypted)",
    label: "Nintendo DSi",
    classify: "game",
    outputs: { game: "dsi.json" },
  },
  {
    path: "No-Intro/Nintendo - Nintendo 64 (BigEndian)",
    label: "Nintendo 64",
    classify: "game",
    outputs: { game: "n64.json" },
  },
  {
    path: "No-Intro/Nintendo - Game Boy",
    label: "Game Boy",
    classify: "game",
    outputs: { game: "gb.json" },
  },
  {
    path: "No-Intro/Nintendo - Game Boy Color",
    label: "Game Boy Color",
    classify: "game",
    outputs: { game: "gbc.json" },
  },
  {
    path: "No-Intro/Nintendo - Game Boy Advance",
    label: "Game Boy Advance",
    classify: "game",
    outputs: { game: "gba.json" },
  },
  // Wii U CDN dump uses No-Intro friendly names tagged (Update)/(DLC); split per type.
  {
    path: "No-Intro/Nintendo - Wii U (Digital) (CDN)",
    label: "Wii U",
    classify: "auto-wiiu",
    outputs: {
      game: "wiiu.json",
      update: "wiiu-updates.json",
      dlc: "wiiu-dlc.json",
    },
  },
  {
    path: "Redump/Nintendo - Wii - NKit RVZ [zstd-19-128k]",
    label: "Wii",
    classify: "game",
    outputs: { game: "wii.json" },
  },
  {
    path: "Redump/Nintendo - GameCube - NKit RVZ [zstd-19-128k]",
    label: "GameCube",
    classify: "game",
    outputs: { game: "gc.json" },
  },
  {
    path: "No-Intro/Non-Redump - Sony - PlayStation",
    label: "PlayStation",
    classify: "game",
    outputs: { game: "ps1.json" },
  },
  {
    path: "No-Intro/Non-Redump - Sony - PlayStation 2",
    label: "PlayStation 2",
    classify: "game",
    outputs: { game: "ps2.json" },
  },
  // PS3 PSN Content mixes base PKG games and DLC; split into ps3.json + ps3-dlc.json.
  {
    path: "No-Intro/Sony - PlayStation 3 (PSN) (Content)",
    label: "PlayStation 3",
    classify: "auto-ps3-content",
    outputs: { game: "ps3.json", dlc: "ps3-dlc.json" },
  },
  // PS3 Updates — separate catalogue.
  {
    path: "No-Intro/Sony - PlayStation 3 (PSN) (Updates)",
    label: "PlayStation 3",
    classify: "update",
    outputs: { update: "ps3-updates.json" },
  },
  {
    path: "No-Intro/Non-Redump - Sony - PlayStation Portable",
    label: "PSP",
    classify: "game",
    outputs: { game: "psp.json" },
  },
];

/**
 * Filename tags for content we never want in any catalogue — demos, avatars,
 * soundtracks, themes, trials and PlayView extras. Matched case-insensitively
 * as parenthesised No-Intro tags. Entries hitting this are dropped entirely.
 */
function isExcluded(fileName) {
  return /\((Demo|Avatar|Soundtrack|OST|Theme|Trial|PlayView|Wallpaper)\)/i.test(
    fileName
  );
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!n || Number.isNaN(n)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0,
    v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function cleanTitle(fileName) {
  let t = fileName.replace(/\.[a-z0-9]{1,5}$/i, ""); // strip extension
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, ""); // strip (..) and [..] tags
  return t.trim() || fileName;
}

/** Human-readable source name for a (label, contentType) pair. */
function nameFor(label, contentType) {
  if (contentType === "update") return `Minerva — ${label} Updates`;
  if (contentType === "dlc") return `Minerva — ${label} DLC`;
  return `Minerva — ${label}`;
}

/**
 * Classify a Wii U CDN filename.
 *
 * minerva's CDN dump uses No-Intro friendly names, not raw title IDs, so the
 * content type is carried in the parenthesised tags:
 *   "<Title> (Region) (Update)" → update
 *   "<Title> (Region) (DLC)"    → DLC (also "(AOC)" add-on content)
 *   everything else             → base game (incl. Virtual Console, Beta)
 *
 * A bare 16-hex title-ID prefix is still honoured as a fallback.
 */
function classifyWiiuFile(fileName) {
  if (/\(Update\)/i.test(fileName))
    return { contentType: "update", titleId: null };
  if (/\((DLC|AOC|Add-?On Content)\)/i.test(fileName))
    return { contentType: "dlc", titleId: null };

  const m = fileName.match(/^([0-9A-Fa-f]{16})/);
  if (m) {
    const tid = m[1].toUpperCase();
    if (tid.startsWith("0005000E"))
      return { contentType: "update", titleId: tid.slice(8) };
    if (tid.startsWith("0005000C"))
      return { contentType: "dlc", titleId: tid.slice(8) };
    return {
      contentType: "game",
      titleId: tid.startsWith("00050000") ? tid.slice(8) : null,
    };
  }

  return { contentType: "game", titleId: null };
}

/**
 * Classify a PS3 PSN Content filename as either a base game or DLC.
 * (Demos/avatars/etc. are already removed by isExcluded() before this runs.)
 *
 * Returns { contentType: "game" | "dlc", titleId }.
 */
function classifyPs3ContentFile(fileName) {
  // Extract title ID (e.g. NPEB01234 or BCUS98174)
  const tidMatch = fileName.match(/([A-Z]{4}\d{5})/);
  const titleId = tidMatch ? tidMatch[1] : null;

  if (/\(DLC\)/i.test(fileName)) return { contentType: "dlc", titleId };

  // A plain PKG named just for the title ID is a base game.
  const basePkgPattern = /^[A-Z]{4}\d{5}(v\d+|\s*\(.*\))?\.(pkg|zip)$/i;
  if (basePkgPattern.test(fileName)) return { contentType: "game", titleId };

  // Addon packages typically carry a dash-suffix after the title ID.
  if (titleId && new RegExp(`${titleId}-[A-Z0-9]`, "i").test(fileName)) {
    return { contentType: "dlc", titleId };
  }

  return { contentType: "game", titleId };
}

// ── Open database ────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all();
console.error("Tables:", tables.map((t) => t.name).join(", "));
const tableName =
  tables.find((t) => /file/i.test(t.name))?.name || tables[0].name;
const cols = db
  .prepare(`PRAGMA table_info(${tableName})`)
  .all()
  .map((c) => c.name);
console.error(`Using table '${tableName}' columns:`, cols.join(", "));

const has = (c) => cols.includes(c);
const pathCol = ["full_path", "path", "slug"].find(has) || "full_path";
const nameCol = ["file_name", "name", "filename"].find(has) || "file_name";
const sizeCol = ["size", "file_size"].find(has);
const magnetCol = ["magnet"].find(has);
const soCol = ["so_id", "so"].find(has);

if (!magnetCol) {
  console.error("No magnet column found — aborting.");
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const stmt = db.prepare(
  `SELECT * FROM ${tableName} WHERE ${pathCol} LIKE ? AND ${magnetCol} IS NOT NULL AND ${magnetCol} != ''`
);

const summary = {};
let excludedTotal = 0;
for (const def of PLATFORM_DEFS) {
  const like = `%${def.path}/%`;
  const rows = stmt.all(like);
  const seen = new Set();
  const buckets = {}; // contentType -> downloads[]

  for (const row of rows) {
    const fileName = row[nameCol] || "";
    if (!fileName || seen.has(fileName)) continue;
    seen.add(fileName);

    if (isExcluded(fileName)) {
      excludedTotal += 1;
      continue;
    }

    let contentType = def.classify;
    let titleId = null;
    if (def.classify === "auto-wiiu") {
      ({ contentType, titleId } = classifyWiiuFile(fileName));
    } else if (def.classify === "auto-ps3-content") {
      ({ contentType, titleId } = classifyPs3ContentFile(fileName));
    }

    // Skip any content type this platform doesn't emit a file for.
    if (!def.outputs[contentType]) continue;

    let magnet = row[magnetCol];
    if (soCol && row[soCol] != null) magnet += `&so=${row[soCol]}`;

    (buckets[contentType] ??= []).push({
      title: cleanTitle(fileName),
      fileSize: sizeCol ? humanSize(row[sizeCol]) : null,
      uris: [magnet],
      uploadDate: null,
      fileName,
      contentType,
      ...(titleId ? { titleId } : {}),
    });
  }

  for (const [contentType, file] of Object.entries(def.outputs)) {
    const downloads = buckets[contentType] || [];
    const source = { name: nameFor(def.label, contentType), downloads };
    const outPath = path.join(OUT_DIR, file);
    fs.writeFileSync(outPath, JSON.stringify(source));
    summary[file] = downloads.length;
    console.error(`${file}: ${downloads.length} entries -> ${outPath}`);
  }
}

console.error(`\nExcluded (demo/avatar/soundtrack/etc.): ${excludedTotal}`);
console.error("\nSummary:", JSON.stringify(summary, null, 2));
db.close();
