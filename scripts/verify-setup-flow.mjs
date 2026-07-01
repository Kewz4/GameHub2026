#!/usr/bin/env node
/* global globalThis */
/**
 * Verifies the setup-flow audit fixes against the running app:
 *  S1  Launch gate: openClassicsGame for an unconfigured emulator throws an
 *      error whose message CONTAINS "EMULATOR_NOT_CONFIGURED" — the substring
 *      the renderer's getClassicsLaunchErrorCode now matches (the old strict
 *      `=== "EMULATOR_NOT_CONFIGURED"` never matched the IPC-wrapped message,
 *      so the "route to Settings" gate never fired).
 *  S2  Post-setup deep link: navigating to /library?console=n64 auto-filters
 *      the library to that console's games (the setup/scan "Browse games" flow
 *      lands here). Old code wrote an unread library-category key → unfiltered.
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

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

const discDir = fs.mkdtempSync(path.join(os.tmpdir(), "rom-"));
const discFile = path.join(discDir, "N64 Mario.z64");
fs.writeFileSync(discFile, "x");

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: [path.resolve("out/main/index.js"), "--no-sandbox"],
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
await win
  .evaluate(() =>
    window.electron.updateUserPreferences({ onboardingComplete: true })
  )
  .catch(() => {});

// Seed a mixed library of console games (n64 + ps1) and make sure no emulator
// is configured (so the launch gate fires).
await app.evaluate(
  async (_, { objId, disc }) => {
    const s = globalThis.__levelSublevels;
    await s.gamesSublevel.clear();
    for (const sys of ["n64", "ps1"])
      await s.emulatorsSublevel
        .put(sys, {
          system: sys,
          binary: "ralibretro",
          executablePath: null,
          detectedVersion: null,
          detectedAt: null,
          romFolders: [],
          lastScanAt: null,
          totalFiles: 0,
          totalSizeBytes: 0,
        })
        .catch(() => {});
    const rom = (id, title, platform, extra = {}) => ({
      objectId: id,
      title,
      shop: "launchbox",
      platform,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      addedToLibraryAt: new Date().toISOString(),
      libraryOrigin: "catalog",
      ...extra,
    });
    await s.gamesSublevel.put(
      `launchbox:${objId}`,
      rom(objId, "N64 Mario", "Nintendo 64", {
        discs: [
          {
            path: disc,
            label: "N64 Mario",
            fileName: "N64 Mario.z64",
            sku: null,
          },
        ],
        selectedDiscPath: disc,
      })
    );
    await s.gamesSublevel.put(
      "launchbox:n64zelda",
      rom("n64zelda", "N64 Zelda", "Nintendo 64")
    );
    await s.gamesSublevel.put(
      "launchbox:ps1crash",
      rom("ps1crash", "PS1 Crash", "PlayStation")
    );
  },
  { objId: "n64mario", disc: discFile }
);

// ── S1: launch gate throws a message containing EMULATOR_NOT_CONFIGURED ─────────
console.log("[S1] Launch gate surfaces EMULATOR_NOT_CONFIGURED");
const launch = await win
  .evaluate(async () => {
    try {
      await window.electron.openClassicsGame("launchbox", "n64mario");
      return { thrown: false };
    } catch (e) {
      return { thrown: true, message: String(e) };
    }
  })
  .catch((e) => ({ thrown: true, message: String(e) }));
if (launch.thrown && /EMULATOR_NOT_CONFIGURED/.test(launch.message))
  ok(`message contains the code token → includes() extractor matches`);
else if (launch.thrown && /NO_DISC/.test(launch.message))
  fail("got NO_DISC — disc should exist; gate not reached");
else if (!launch.thrown) fail("launch did not gate (should have thrown)");
else fail("unexpected launch error", String(launch.message).slice(0, 140));

// ── S2: ?console= deep link auto-filters the library ───────────────────────────
console.log("\n[S2] /library?console=n64 lands filtered to Nintendo 64");
await win.evaluate(() => {
  window.location.hash = "/";
});
await new Promise((r) => setTimeout(r, 500));
await win.evaluate(() => {
  window.location.hash = "/library?console=n64";
});
await win
  .locator(".library__store-filters")
  .first()
  .waitFor({ state: "visible", timeout: 20_000 })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2000));

const cardCount = () =>
  win
    .locator(".library__games-grid li")
    .count()
    .catch(() => -1);
const selectValue = await win
  .locator('select[aria-label="Filter by console"]')
  .inputValue()
  .catch(() => "");
const count = await cardCount();
if (selectValue === "n64" && count === 2)
  ok(`console preselected to n64 and grid shows ${count} N64 games`);
else fail("deep link did not filter", `select=${selectValue} cards=${count}`);
await win.screenshot({ path: path.join(OUT, "setup-flow-deeplink.png") });

console.log(`\n${"─".repeat(58)}`);
console.log(`Setup flow: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
