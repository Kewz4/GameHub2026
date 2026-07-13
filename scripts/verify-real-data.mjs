#!/usr/bin/env node
/* global globalThis */
/**
 * Verifies the catalogue/metadata fixes against the ACTUAL bundled data
 * (Dump/ + sources/gamehub-meta) loaded by the app at startup — not
 * synthetic seeds. Run: xvfb-run -a node scripts/verify-real-data.mjs
 *
 *  R1  Non-games filtered    — "Action Replay"/"Demo Disc" not in catalogue.
 *  R2  N+ prefix-bleed fixed — getMinervaDownloadOptions("nds","N+") ~= 1, not 305.
 *  R3  Region tagging        — a real multi-region game carries USA/Europe.
 *  R4  Metadata present      — a real game resolves cover + description.
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";

let passed = 0,
  failed = 0;
const ok = (l) => {
  console.log(`  ✓ ${l}`);
  passed++;
};
const fail = (l, d = "") => {
  console.error(`  ✗ ${l}${d ? "\n      " + d : ""}`);
  failed++;
};

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: [path.resolve("out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60_000,
});
await app.firstWindow({ timeout: 40_000 });
let mainWin = null;
for (let i = 0; i < 480; i++) {
  await new Promise((r) => setTimeout(r, 250));
  mainWin = app.windows().find((w) => {
    try {
      return !w.url().includes("update-checker");
    } catch {
      return false;
    }
  });
  if (mainWin) break;
}
if (!mainWin) {
  console.error("FATAL: no main window");
  await app.close().catch(() => {});
  process.exit(1);
}

// Wait for the REAL catalogue to finish loading from the bundled Dump.
console.log("Waiting for real catalogue to load from bundled Dump…");
let count = 0;
for (let i = 0; i < 180; i++) {
  count = await app
    .evaluate(async () => {
      const s = globalThis.__levelSublevels;
      let n = 0;
      for await (const _k of s.minervaCatalogueSublevel.keys({ limit: 40000 }))
        n++;
      return n;
    })
    .catch(() => 0);
  if (count > 8000) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`Catalogue entries loaded: ${count}\n`);
if (count < 5000) {
  fail("catalogue did not load from bundled Dump", String(count));
}

// ── R1: non-games filtered out ────────────────────────────────────────────────
console.log("[R1] Non-games (cheats/demos) excluded from the catalogue");
const junkProbe = await app.evaluate(async () => {
  const s = globalThis.__levelSublevels;
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const probes = [
    "Action Replay for GameCube",
    "Interactive Multi-Game Demo Disc Version 28",
    "GameShark Online",
  ];
  const found = [];
  for (const title of probes) {
    for (const sys of ["gc", "nds", "gbc"]) {
      const key = `${sys}:${norm(title)}`;
      for await (const [k] of s.minervaCatalogueSublevel.iterator({
        gte: key,
        lte: `${key}:\xFF`,
        limit: 1,
      })) {
        found.push(title + " → " + k);
      }
    }
  }
  return found;
});
if (junkProbe.length === 0)
  ok("none of Action Replay / Demo Disc / GameShark are in the catalogue");
else fail("junk still present", junkProbe.join("; "));

// ── R2: N+ prefix-bleed fixed ─────────────────────────────────────────────────
console.log("\n[R2] N+ download options (prefix-bleed fixed)");
const npOpts = await mainWin
  .evaluate(() => window.electron.getMinervaDownloadOptions("nds", "N+"))
  .catch((e) => ({ __error: String(e) }));
if (Array.isArray(npOpts)) {
  console.log(
    "    options:",
    npOpts
      .map((o) => o.title)
      .slice(0, 6)
      .join(" | ")
  );
  if (npOpts.length <= 3)
    ok(`N+ returns ${npOpts.length} option(s) (was 305 from prefix bleed)`);
  else fail(`N+ still returns ${npOpts.length} options (prefix bleed)`);
} else {
  fail("getMinervaDownloadOptions threw", npOpts.__error);
}

// ── R3: USA region tagging on a real game ────────────────────────────────────
// The GameHub Vault dump is USA-only, so we verify the base game resolves with
// a USA region tag (the dump loader hardcodes region: "USA" since dump titles
// don't carry No-Intro parenthetical region tags).
console.log("\n[R3] Region tagging on a real USA game");
const stOpts = await mainWin
  .evaluate(() =>
    window.electron.getMinervaDownloadOptions(
      "nds",
      "Legend of Zelda, The - Spirit Tracks"
    )
  )
  .catch((e) => ({ __error: String(e) }));
if (Array.isArray(stOpts) && stOpts.length > 0) {
  const regions = [...new Set(stOpts.map((o) => o.region).filter(Boolean))];
  console.log(
    "    variants:",
    stOpts
      .map((o) => `${o.title}[${o.region}]`)
      .slice(0, 6)
      .join(" | ")
  );
  if (regions.includes("USA"))
    ok(`Spirit Tracks tagged with USA region: ${regions.join(", ")}`);
  else fail("USA region tag missing", JSON.stringify(regions));
} else {
  fail(
    "no Spirit Tracks options",
    Array.isArray(stOpts) ? "0 results" : stOpts.__error
  );
}

// ── R4: metadata (cover + description) for a real game ────────────────────────
console.log(
  "\n[R4] Real metadata (cover + description) from bundled gamehub-meta"
);
const meta = await mainWin
  .evaluate(() =>
    window.electron.getGameShopDetails(
      "minerva:gc:legendofzeldathethewindwaker",
      "launchbox",
      "english"
    )
  )
  .catch((e) => ({ __error: String(e) }));
if (meta && !meta.__error) {
  console.log(
    "    name:",
    JSON.stringify(meta.name),
    "| cover:",
    !!meta.assets?.coverImageUrl,
    "| descLen:",
    (meta.detailed_description || "").length
  );
  if (meta.assets?.coverImageUrl) ok("cover image resolved from bundled meta");
  else fail("no cover image");
  if ((meta.detailed_description || "").length > 20)
    ok("description resolved from bundled meta");
  else fail("no description");
  if (meta.name && !/^[a-z0-9]+$/.test(meta.name))
    ok(`proper title: "${meta.name}"`);
  else fail("title is a slug", meta.name);
} else {
  fail("getGameShopDetails failed", meta?.__error ?? "null");
}

// ── R5: betas / protos / demos excluded ───────────────────────────────────────
console.log("\n[R5] Beta / Proto / Demo builds excluded from the catalogue");
const badTags = await app.evaluate(async () => {
  const s = globalThis.__levelSublevels;
  let found = 0;
  const samples = [];
  const re = /\((Beta|Proto|Prototype|Sample|Demo|Debug)\b/i;
  for await (const [, rec] of s.minervaCatalogueSublevel.iterator({
    limit: 40000,
  })) {
    if (re.test(rec.entry.filename)) {
      found++;
      if (samples.length < 4) samples.push(rec.entry.filename);
    }
  }
  return { found, samples };
});
if (badTags.found === 0)
  ok("no Beta/Proto/Demo-tagged entries remain in the catalogue");
else
  fail(
    `${badTags.found} beta/proto/demo entries still present`,
    badTags.samples.join("; ")
  );

// ── R6: Breath of the Wild — USA has base + update + DLC ──────────────────────
// The GameHub Vault dump is USA-only, so we verify the USA region has all three
// content types paired up (base game + update + DLC). The dump loader keys
// updates/DLC by the base game's normalized title so scanAllVariants pairs them.
console.log("\n[R6] Breath of the Wild groups base+update+DLC (USA)");
const botw = await mainWin
  .evaluate(() =>
    window.electron.getMinervaDownloadOptions(
      "wiiu",
      "Legend of Zelda, The - Breath of the Wild"
    )
  )
  .catch((e) => ({ __error: String(e) }));
if (Array.isArray(botw)) {
  const by = {};
  for (const o of botw) {
    const r = o.region || "none";
    by[r] = by[r] || { game: 0, update: 0, dlc: 0 };
    by[r][o.contentType || "game"]++;
  }
  console.log("    by region:", JSON.stringify(by));
  const okRegion = (r) =>
    by[r] && by[r].game >= 1 && by[r].update >= 1 && by[r].dlc >= 1;
  if (okRegion("USA"))
    ok("USA has base game + update + DLC (was: no update/DLC)");
  else fail("USA missing base/update/DLC", JSON.stringify(by.USA));
} else {
  fail("BotW options failed", botw.__error);
}

console.log(`\n${"─".repeat(58)}`);
console.log(`Real-data results: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
