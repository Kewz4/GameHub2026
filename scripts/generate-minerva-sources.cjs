#!/usr/bin/env node
/* Generate per-platform Minerva source JSON files from hashes.db (SQLite). */
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const DB_PATH = process.argv[2] || "./hashes.db";
const OUT_DIR = process.argv[3] || "./sources";

// system -> minerva full_path prefix (matches the './<Category>/<Platform>/' slug)
const PLATFORMS = {
  n3ds: "No-Intro/Nintendo - Nintendo 3DS (Decrypted)",
  nds: "No-Intro/Nintendo - Nintendo DS (Decrypted)",
  dsi: "No-Intro/Nintendo - Nintendo DSi (Decrypted)",
  n64: "No-Intro/Nintendo - Nintendo 64 (BigEndian)",
  gb: "No-Intro/Nintendo - Game Boy",
  gbc: "No-Intro/Nintendo - Game Boy Color",
  gba: "No-Intro/Nintendo - Game Boy Advance",
  wiiu: "Redump/Nintendo - Wii U - WUX",
  wii: "Redump/Nintendo - Wii - NKit RVZ [zstd-19-128k]",
  gc: "Redump/Nintendo - GameCube - NKit RVZ [zstd-19-128k]",
  ps1: "No-Intro/Non-Redump - Sony - PlayStation",
  ps2: "No-Intro/Non-Redump - Sony - PlayStation 2",
  ps3: "No-Intro/Sony - PlayStation 3 (PSN) (Content)",
  psp: "No-Intro/Non-Redump - Sony - PlayStation Portable",
};

const SYSTEM_LABELS = {
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Wii U",
  wii: "Wii",
  gc: "GameCube",
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PSP",
};

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

const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Discover schema
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
for (const [system, platformPath] of Object.entries(PLATFORMS)) {
  const like = `%${platformPath}/%`;
  const rows = stmt.all(like);
  const seen = new Set();
  const downloads = [];
  for (const row of rows) {
    const fileName = row[nameCol] || "";
    if (!fileName || seen.has(fileName)) continue;
    seen.add(fileName);
    // Store the compact base magnet (with so_id) — the app appends the shared
    // tracker list at download time, mirroring minerva's own rom.js behaviour.
    let magnet = row[magnetCol];
    if (soCol && row[soCol] != null) magnet += `&so=${row[soCol]}`;
    downloads.push({
      title: cleanTitle(fileName),
      fileSize: sizeCol ? humanSize(row[sizeCol]) : null,
      uris: [magnet],
      uploadDate: null,
      fileName,
    });
  }
  const source = { name: `Minerva — ${SYSTEM_LABELS[system]}`, downloads };
  const outPath = path.join(OUT_DIR, `${system}.json`);
  fs.writeFileSync(outPath, JSON.stringify(source));
  summary[system] = downloads.length;
  console.error(`${system}: ${downloads.length} games -> ${outPath}`);
}

console.error("\nSummary:", JSON.stringify(summary, null, 2));
db.close();
