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
 * `path`        – minerva full_path prefix (matches `.<Category>/<Platform>/` slug)
 * `output`      – output JSON filename (without directory)
 * `label`       – human-facing console name used in the "name" field
 * `contentType` – "game" | "update" | "dlc" | "auto"
 *                 "auto" means classify each row by its filename (see classifyRow()).
 */
const PLATFORM_DEFS = [
  {
    path: "No-Intro/Nintendo - Nintendo 3DS (Decrypted)",
    output: "n3ds.json",
    label: "Nintendo 3DS",
    contentType: "game",
  },
  {
    path: "No-Intro/Nintendo - Nintendo DS (Decrypted)",
    output: "nds.json",
    label: "Nintendo DS",
    contentType: "game",
  },
  {
    path: "No-Intro/Nintendo - Nintendo DSi (Decrypted)",
    output: "dsi.json",
    label: "Nintendo DSi",
    contentType: "game",
  },
  {
    path: "No-Intro/Nintendo - Nintendo 64 (BigEndian)",
    output: "n64.json",
    label: "Nintendo 64",
    contentType: "game",
  },
  {
    path: "No-Intro/Nintendo - Game Boy",
    output: "gb.json",
    label: "Game Boy",
    contentType: "game",
  },
  {
    path: "No-Intro/Nintendo - Game Boy Color",
    output: "gbc.json",
    label: "Game Boy Color",
    contentType: "game",
  },
  {
    path: "No-Intro/Nintendo - Game Boy Advance",
    output: "gba.json",
    label: "Game Boy Advance",
    contentType: "game",
  },
  // Wii U: CDN path mixes base games (00050000…), updates (0005000E…), and DLC (0005000C…).
  // All entries go into wiiu.json; each gets a contentType derived from its title ID prefix.
  {
    path: "No-Intro/Nintendo - Wii U (Digital) (CDN)",
    output: "wiiu.json",
    label: "Wii U",
    contentType: "auto-wiiu",
  },
  {
    path: "Redump/Nintendo - Wii - NKit RVZ [zstd-19-128k]",
    output: "wii.json",
    label: "Wii",
    contentType: "game",
  },
  {
    path: "Redump/Nintendo - GameCube - NKit RVZ [zstd-19-128k]",
    output: "gc.json",
    label: "GameCube",
    contentType: "game",
  },
  {
    path: "No-Intro/Non-Redump - Sony - PlayStation",
    output: "ps1.json",
    label: "PlayStation",
    contentType: "game",
  },
  {
    path: "No-Intro/Non-Redump - Sony - PlayStation 2",
    output: "ps2.json",
    label: "PlayStation 2",
    contentType: "game",
  },
  // PS3 PSN Content mixes base PKG games and DLC; classified per filename.
  {
    path: "No-Intro/Sony - PlayStation 3 (PSN) (Content)",
    output: "ps3.json",
    label: "PlayStation 3",
    contentType: "auto-ps3-content",
  },
  // PS3 Updates — separate catalogue.
  {
    path: "No-Intro/Sony - PlayStation 3 (PSN) (Updates)",
    output: "ps3-updates.json",
    label: "PlayStation 3 Updates",
    contentType: "update",
  },
  {
    path: "No-Intro/Non-Redump - Sony - PlayStation Portable",
    output: "psp.json",
    label: "PSP",
    contentType: "game",
  },
];

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

/**
 * Classify a Wii U CDN filename.
 *
 * minerva's CDN dump uses No-Intro friendly names, not raw title IDs, so the
 * content type is carried in the parenthesised tags:
 *   "<Title> (Region) (Update)" → update
 *   "<Title> (Region) (DLC)"    → DLC (also "(AOC)" add-on content)
 *   everything else             → base game (incl. Virtual Console, Demo, Beta)
 *
 * A bare 16-hex title-ID prefix is still honoured as a fallback for any raw
 * CDN entries that slip through.
 */
function classifyWiiuFile(fileName) {
  if (/\(Update\)/i.test(fileName)) return { contentType: "update", titleId: null };
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
 * Classify a PS3 PSN Content filename.
 * Base game PKG: <TitleID>.pkg  (exactly 9 uppercase alphanumeric chars before .pkg)
 * DLC / add-on:  <TitleID>-A<8-digits>.pkg  or similar suffix after titleId
 * We also exclude obvious non-game types (Demo, Avatar, PlayView, Trial).
 *
 * Returns { contentType, titleId }.
 */
function classifyPs3ContentFile(fileName) {
  const lower = fileName.toLowerCase();
  // Exclude demos, avatars, themes, etc. — treat as DLC for completeness
  const looksLikeDlc =
    lower.includes("(dlc)") ||
    lower.includes("(demo)") ||
    lower.includes("(avatar)") ||
    lower.includes("(trial)") ||
    lower.includes("(playview)") ||
    lower.includes("(theme)") ||
    lower.includes("(soundtrack)");

  // Extract title ID (e.g. NPEB01234 or BCUS98174)
  const tidMatch = fileName.match(/([A-Z]{4}\d{5})/);
  const titleId = tidMatch ? tidMatch[1] : null;

  if (looksLikeDlc) return { contentType: "dlc", titleId };

  // If file looks like a plain PKG with just the title ID it's a base game
  const basePkgPattern = /^[A-Z]{4}\d{5}(v\d+|\s*\(.*\))?\.(pkg|zip)$/i;
  if (basePkgPattern.test(fileName)) return { contentType: "game", titleId };

  // Addon/DLC packages typically have a dash-suffix after the title ID
  if (titleId && new RegExp(`${titleId}-[A-Z0-9]`, "i").test(fileName)) {
    return { contentType: "dlc", titleId };
  }

  // Default: treat as game (base game without strict filename pattern)
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
for (const def of PLATFORM_DEFS) {
  const like = `%${def.path}/%`;
  const rows = stmt.all(like);
  const seen = new Set();
  const downloads = [];

  for (const row of rows) {
    const fileName = row[nameCol] || "";
    if (!fileName || seen.has(fileName)) continue;
    seen.add(fileName);

    let magnet = row[magnetCol];
    if (soCol && row[soCol] != null) magnet += `&so=${row[soCol]}`;

    let contentType = def.contentType;
    let titleId = null;

    if (def.contentType === "auto-wiiu") {
      ({ contentType, titleId } = classifyWiiuFile(fileName));
    } else if (def.contentType === "auto-ps3-content") {
      ({ contentType, titleId } = classifyPs3ContentFile(fileName));
    }

    downloads.push({
      title: cleanTitle(fileName),
      fileSize: sizeCol ? humanSize(row[sizeCol]) : null,
      uris: [magnet],
      uploadDate: null,
      fileName,
      contentType,
      ...(titleId ? { titleId } : {}),
    });
  }

  const source = { name: `Minerva — ${def.label}`, downloads };
  const outPath = path.join(OUT_DIR, def.output);
  fs.writeFileSync(outPath, JSON.stringify(source));
  summary[def.output] = downloads.length;
  console.error(`${def.output}: ${downloads.length} entries -> ${outPath}`);
}

console.error("\nSummary:", JSON.stringify(summary, null, 2));
db.close();
