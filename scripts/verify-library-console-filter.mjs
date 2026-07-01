#!/usr/bin/env node
/* global globalThis */
/**
 * Verifies the Library "Console" filter pill against the running app:
 *  L1  The Console dropdown appears and only offers consoles that have games.
 *  L2  Selecting a console narrows the grid to that console's ROMs only.
 *  L3  Back to "Console" (all) shows everything again.
 * Captures screenshots of the unfiltered and filtered library.
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve("scratch-shots");
fs.mkdirSync(OUT, { recursive: true });

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
  args: [
    path.resolve("out/main/index.js"),
    "--no-sandbox",
    "--force-device-scale-factor=1",
    "--high-dpi-support=1",
  ],
  cwd: process.cwd(),
  timeout: 60_000,
});
await app.firstWindow({ timeout: 40_000 });
let win = null,
  proceeded = false;
for (let i = 0; i < 480; i++) {
  await new Promise((r) => setTimeout(r, 250));
  win = app.windows().find((w) => {
    try {
      return !w.url().includes("update-checker");
    } catch {
      return false;
    }
  });
  if (win) break;
  if (!proceeded && i > 8) {
    const c = app.windows().find((w) => {
      try {
        return w.url().includes("update-checker");
      } catch {
        return false;
      }
    });
    if (c) {
      proceeded = true;
      await c
        .evaluate(() => window.electron.updateCheckerProceed())
        .catch(() => {});
    }
  }
}
if (!win) {
  console.error("FATAL: no window");
  await app.close().catch(() => {});
  process.exit(1);
}

await win.setViewportSize({ width: 1920, height: 1080 }).catch(() => {});
await new Promise((r) => setTimeout(r, 400));

// Seed a mixed library: three consoles + one Steam game.
await app.evaluate(async () => {
  const s = globalThis.__levelSublevels;
  await s.gamesSublevel.clear();
  const put = (key, game) => s.gamesSublevel.put(key, game);
  const rom = (objectId, title, platform) => ({
    objectId,
    title,
    shop: "launchbox",
    platform,
    isDeleted: false,
    playTimeInMilliseconds: 0,
    addedToLibraryAt: new Date().toISOString(),
    libraryOrigin: "catalog",
  });
  await put("launchbox:n64mario", rom("n64mario", "N64 Mario", "Nintendo 64"));
  await put("launchbox:n64zelda", rom("n64zelda", "N64 Zelda", "Nintendo 64"));
  await put("launchbox:ps1crash", rom("ps1crash", "PS1 Crash", "PlayStation"));
  await put(
    "launchbox:gbametroid",
    rom("gbametroid", "GBA Metroid", "Game Boy Advance")
  );
  await put("steam:portal", {
    objectId: "400",
    title: "Steam Portal",
    shop: "steam",
    platform: null,
    isDeleted: false,
    playTimeInMilliseconds: 0,
    addedToLibraryAt: new Date().toISOString(),
    libraryOrigin: "sync",
  });
});

await win.evaluate(() =>
  window.electron.updateUserPreferences({ onboardingComplete: true })
);
await win.evaluate(() => {
  window.location.hash = "/";
});
await new Promise((r) => setTimeout(r, 500));
await win.evaluate(() => {
  window.location.hash = "/library";
});
await win
  .locator(".library__store-filters")
  .first()
  .waitFor({ state: "visible", timeout: 20_000 })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const select = win.locator('select[aria-label="Filter by console"]');

// ── L1: dropdown present with only the consoles that have games ────────────────
console.log("[L1] Console dropdown lists only consoles with games");
if (await select.count()) {
  const opts = await select
    .locator("option")
    .allTextContents()
    .catch(() => []);
  const expected = [
    "Console",
    "PlayStation",
    "Nintendo 64",
    "Game Boy Advance",
  ];
  const missing = expected.filter((e) => !opts.includes(e));
  if (
    missing.length === 0 &&
    !opts.includes("PSP") &&
    !opts.includes("Nintendo DS")
  )
    ok(`options = ${JSON.stringify(opts)} (no empty consoles offered)`);
  else fail(`unexpected options ${JSON.stringify(opts)}`, `missing ${missing}`);
} else {
  fail("Console dropdown not rendered");
}
await win.screenshot({
  path: path.join(OUT, "library-all.png"),
  fullPage: false,
});

// The number of game cards currently rendered in the grid.
const cardCount = () =>
  win
    .locator(".library__games-grid li")
    .count()
    .catch(() => -1);
// The card titles (each card root carries title={game.title}).
const gridTitles = () =>
  win
    .locator(".library__games-grid li [title]")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("title") || "").filter(Boolean)
    )
    .then((arr) => Array.from(new Set(arr)).join(" | "))
    .catch(() => "");

// ── L2: selecting Nintendo 64 narrows to N64 games ─────────────────────────────
console.log("\n[L2] Selecting a console filters the grid");
await select.selectOption("n64").catch(() => {});
await new Promise((r) => setTimeout(r, 1200));
const n64Count = await cardCount();
const n64Text = await gridTitles();
if (n64Count === 2 && !/PS1 Crash|GBA Metroid|Steam Portal/.test(n64Text))
  ok(`Nintendo 64 selected → ${n64Count} cards (${n64Text})`);
else fail("N64 filter wrong", `${n64Count} cards: ${n64Text}`);
await win.screenshot({
  path: path.join(OUT, "library-n64.png"),
  fullPage: false,
});

// ── L3: back to all ────────────────────────────────────────────────────────────
console.log("\n[L3] Resetting to Console (all) shows everything again");
await select.selectOption("all").catch(() => {});
await new Promise((r) => setTimeout(r, 1200));
const allCount = await cardCount();
if (allCount === 5) ok(`all ${allCount} games visible again`);
else fail("reset did not restore full list", `${allCount} cards`);

console.log(`\n${"─".repeat(58)}`);
console.log(`Library console filter: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
