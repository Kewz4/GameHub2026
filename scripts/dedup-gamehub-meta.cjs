#!/usr/bin/env node
/**
 * Deduplicates sources/gamehub-meta/<system>.json entries.
 *
 * Strategy:
 * 1. JP→EN alias substitution: if applying a known JP→EN alias produces a
 *    title that exists in the same file AND that entry has a description,
 *    drop the JP entry (the EN one is canonical).
 * 2. Description-match dedup: if two entries share the same description text
 *    AND their title tokens overlap ≥70%, they're the same game — keep the
 *    one with more metadata (description + art), prefer shorter/simpler title.
 */

const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "sources", "gamehub-meta");
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

// Known JP brand → EN brand substitutions (order matters — longer first)
const JP_EN = [
  ["Biohazard - Code - Veronica X", "Resident Evil - Code - Veronica X"],
  ["Biohazard - Revelations 2", "Resident Evil - Revelations 2"],
  ["Biohazard - Revelations", "Resident Evil - Revelations"],
  [
    "Biohazard - Operation Raccoon City",
    "Resident Evil - Operation Raccoon City",
  ],
  ["Biohazard 0", "Resident Evil 0"],
  ["Biohazard 1", "Resident Evil"],
  ["Biohazard 2", "Resident Evil 2"],
  ["Biohazard 3", "Resident Evil 3"],
  ["Biohazard 4", "Resident Evil 4"],
  ["Biohazard 5", "Resident Evil 5"],
  ["Biohazard 6", "Resident Evil 6"],
  ["Biohazard 7", "Resident Evil 7"],
  ["Biohazard", "Resident Evil"],
  ["Rockman EXE", "Mega Man Battle Network"],
  ["Rockman Zero", "Mega Man Zero"],
  ["Rockman ZX", "Mega Man ZX"],
  ["Rockman X", "Mega Man X"],
  ["Rockman", "Mega Man"],
  ["Winning Eleven", "Pro Evolution Soccer"],
  ["Minna no Golf", "Everybody's Golf"],
  ["Hot Shots Golf", "Everybody's Golf"],
  ["Jikkyou Powerful Pro Yakyuu", "MLB Power Pros"],
  ["Seiken Densetsu 3", "Trials of Mana"],
  ["Seiken Densetsu 2", "Secret of Mana"],
  ["Seiken Densetsu", "Secret of Mana"],
  ["Dragon Quest", "Dragon Quest"], // same brand, catches romanized subtitle dupes
  ["Final Fantasy", "Final Fantasy"], // same brand, catches alt-region variants
];

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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function titleOverlap(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

function metaScore(g) {
  return (
    (g.description ? 10 : 0) +
    (g.coverImageUrl ? 2 : 0) +
    (g.libraryHeroImageUrl ? 2 : 0) +
    (g.logoImageUrl ? 1 : 0) +
    (g.genres?.length ? 1 : 0) +
    (g.releaseYear ? 1 : 0)
  );
}

let grandRemoved = 0;

for (const sys of SYSTEMS) {
  const p = path.join(DIR, `${sys}.json`);
  if (!fs.existsSync(p)) continue;

  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const entries = Object.entries(raw.games); // [key, game]
  const titleToKey = new Map(entries.map(([k, g]) => [g.title, k]));

  const toRemove = new Set();

  // Pass 1: JP→EN alias dedup
  for (const [key, game] of entries) {
    if (toRemove.has(key)) continue;
    for (const [jp, en] of JP_EN) {
      if (!game.title.includes(jp)) continue;
      const enTitle = game.title.replace(jp, en);
      if (enTitle === game.title) continue; // no change (same brand both sides)
      const enKey = titleToKey.get(enTitle);
      if (!enKey || enKey === key) continue;
      const enGame = raw.games[enKey];
      // Drop the JP entry — EN entry is canonical
      toRemove.add(key);
      // Copy any metadata the JP entry has that EN is missing
      if (!enGame.description && game.description)
        enGame.description = game.description;
      if (!enGame.genres?.length && game.genres?.length)
        enGame.genres = game.genres;
      if (!enGame.releaseYear && game.releaseYear)
        enGame.releaseYear = game.releaseYear;
      console.log(`[${sys}] JP→EN drop: "${game.title}" (kept "${enTitle}")`);
      break;
    }
  }

  // Pass 2: description-match dedup (same desc + ≥70% title overlap = same game)
  const descMap = new Map(); // descKey -> [key, game]
  for (const [key, game] of entries) {
    if (toRemove.has(key) || !game.description) continue;
    const dk = game.description.slice(0, 120).trim();
    if (!descMap.has(dk)) {
      descMap.set(dk, [key, game]);
      continue;
    }
    const [otherKey, otherGame] = descMap.get(dk);
    if (toRemove.has(otherKey)) {
      descMap.set(dk, [key, game]);
      continue;
    }
    const overlap = titleOverlap(game.title, otherGame.title);
    if (overlap < 0.7) continue; // different games, same IGDB blurb — skip
    // Keep the one with more metadata; on tie, keep shorter title
    const keepCurrent =
      metaScore(game) > metaScore(otherGame) ||
      (metaScore(game) === metaScore(otherGame) &&
        game.title.length <= otherGame.title.length);
    if (keepCurrent) {
      toRemove.add(otherKey);
      descMap.set(dk, [key, game]);
      console.log(
        `[${sys}] desc-dupe drop: "${otherGame.title}" (kept "${game.title}")`
      );
    } else {
      toRemove.add(key);
      console.log(
        `[${sys}] desc-dupe drop: "${game.title}" (kept "${otherGame.title}")`
      );
    }
  }

  if (!toRemove.size) continue;

  // Rebuild games object without removed entries
  const newGames = {};
  for (const [key, game] of entries) {
    if (!toRemove.has(key)) newGames[key] = game;
  }
  raw.games = newGames;
  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");
  console.log(
    `[${sys}] removed ${toRemove.size} duplicates → ${Object.keys(newGames).length} remain`
  );
  grandRemoved += toRemove.size;
}

console.log(`\nTotal removed: ${grandRemoved}`);
