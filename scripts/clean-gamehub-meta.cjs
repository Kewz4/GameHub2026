#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const STREAMING_APPS =
  /^(Netflix|Hulu Plus?|YouTube( for \w+)?|Amazon( Instant Video| Prime Video|- LOVEFiLM| Video)?|DAZN|Red Bull TV( - .+)?|BBC iPlayer|BBC Sport Player|Crunchyroll|Funimation|Peacock( TV)?|Tubi( TV)?|Vudu|Plex|Crackle|iPlayer|NowTV|Now TV|Rakuten TV|LOVEFiLM|Hulu - .+|HBO( Go| Max)?|Spotify|Twitch)$/i;
const PS_THEMES = /^PlayStation( Plus)? Themes? - /i;
const SONG_PACKS =
  /^(Rock Band|Guitar Hero|Band Hero|DJ Hero) - (Song Pack|Track Pack|Music Pack|Greatest Hits Pack)/i;
const ELITE_DROPS = /elite drops \d/i;
const AVATAR_ITEMS = /^Avatar( Item| Award| Clothing| Prop| Accessory)/i;

const PATTERNS = [
  STREAMING_APPS,
  PS_THEMES,
  SONG_PACKS,
  ELITE_DROPS,
  AVATAR_ITEMS,
];

function isNonGame(title) {
  return PATTERNS.some((p) => p.test(title));
}

const SYSTEMS = [
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
const DIR = path.join(__dirname, "../sources/gamehub-meta");

// Task 1: Strip non-game entries
for (const system of SYSTEMS) {
  const filePath = path.join(DIR, `${system}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const games = data.games;
  const removed = [];

  for (const [key, entry] of Object.entries(games)) {
    if (isNonGame(entry.title)) {
      removed.push(entry.title);
      delete games[key];
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");

  if (removed.length > 0) {
    console.log(`[${system}] Removed ${removed.length} non-game entries:`);
    for (const t of removed) console.log(`  - ${t}`);
  } else {
    console.log(`[${system}] No non-game entries found.`);
  }
}

// Task 2: JP->EN alias pass for PS3
const JP_EN_MAP = [
  { jp: "Biohazard Revelations", en: "Resident Evil Revelations" },
  {
    jp: "Biohazard Operation Raccoon City",
    en: "Resident Evil Operation Raccoon City",
  },
  { jp: "Biohazard", en: "Resident Evil" },
];

const ps3Path = path.join(DIR, "ps3.json");
const ps3Data = JSON.parse(fs.readFileSync(ps3Path, "utf8"));
const ps3Games = ps3Data.games;

// Build a title->entry map for quick lookup (lowercase)
const titleMap = new Map();
for (const entry of Object.values(ps3Games)) {
  titleMap.set(entry.title.toLowerCase(), entry);
}

let aliased = 0;
for (const [_key, entry] of Object.entries(ps3Games)) {
  if (entry.description) continue; // already has description

  let enTitle = null;
  for (const { jp, en } of JP_EN_MAP) {
    if (entry.title.toLowerCase().startsWith(jp.toLowerCase())) {
      // Replace JP prefix with EN prefix
      enTitle = en + entry.title.slice(jp.length);
      break;
    }
  }

  if (!enTitle) continue;

  const enEntry = titleMap.get(enTitle.toLowerCase());
  if (!enEntry || !enEntry.description) continue;

  console.log(`[ps3] Aliasing "${entry.title}" -> "${enTitle}"`);
  if (enEntry.description) entry.description = enEntry.description;
  if (enEntry.genres) entry.genres = enEntry.genres;
  if (enEntry.releaseYear) entry.releaseYear = enEntry.releaseYear;
  aliased++;
}

fs.writeFileSync(ps3Path, JSON.stringify(ps3Data, null, 2) + "\n");
console.log(`[ps3] Aliased ${aliased} JP entries.`);

// Summary
console.log("\n=== SUMMARY ===");
for (const system of SYSTEMS) {
  const filePath = path.join(DIR, `${system}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const games = Object.values(data.games);
  const withDesc = games.filter((g) => g.description).length;
  console.log(
    `${system}: ${games.length} titles, ${withDesc} with descriptions`
  );
}
