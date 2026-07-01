#!/usr/bin/env node
/* global globalThis */
/**
 * Playwright+Electron check of the RetroAchievements wiring against the running
 * app:
 *  R1  Credentials round-trip through updateUserPreferences / getUserPreferences.
 *  R2  The RA watcher only arms for RA-capable, launchbox, emulated games with
 *      credentials set (gating), and is a no-op otherwise — asserted by driving
 *      RaWatcherManager.startPolling directly in the main process and inspecting
 *      its active poll set. No live RA API call is made.
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
let win = null;
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
}
if (!win) {
  console.error("FATAL: no window");
  await app.close().catch(() => {});
  process.exit(1);
}

// ── R1: credentials round-trip ────────────────────────────────────────────────
console.log("[R1] RA credentials persist via user preferences");
await win.evaluate(() =>
  window.electron.updateUserPreferences({
    retroAchievementsUsername: "TestUser",
    retroAchievementsApiKey: "abc123key",
  })
);
const prefs = await win.evaluate(() => window.electron.getUserPreferences());
if (
  prefs?.retroAchievementsUsername === "TestUser" &&
  prefs?.retroAchievementsApiKey === "abc123key"
)
  ok("username + API key saved and read back");
else fail("credentials did not round-trip", JSON.stringify(prefs ?? null));

// ── R2: watcher gating (no live API) ──────────────────────────────────────────
console.log("\n[R2] Watcher arms only for RA-capable emulated games w/ creds");
const gating = await app.evaluate(async () => {
  const mgr = globalThis.__raWatcherManager;
  if (!mgr) return { __missing: true };
  const mk = (objectId, shop, platform) => ({
    objectId,
    shop,
    platform,
    title: objectId,
    iconUrl: null,
  });
  const activeAfter = async (game) => {
    await mgr.startPolling(game);
    const on = mgr.isPolling(game);
    mgr.stopPolling(game);
    return on;
  };
  return {
    gbLaunchbox: await activeAfter(mk("g1", "launchbox", "Nintendo Game Boy")),
    ps2Launchbox: await activeAfter(mk("g2", "launchbox", "Sony PlayStation 2")),
    steamGame: await activeAfter(mk("g3", "steam", "Nintendo Game Boy")),
    noPlatform: await activeAfter(mk("g4", "launchbox", null)),
  };
});
if (gating.__missing) {
  fail(
    "globalThis.__raWatcherManager not exposed — can't assert gating",
    "expose RaWatcherManager (with isPolling) in dev like __levelSublevels"
  );
} else {
  if (gating.gbLaunchbox) ok("Game Boy (RA-capable, launchbox) → polling armed");
  else fail("Game Boy did not arm polling");
  if (!gating.ps2Launchbox) ok("PS2 (no RA support) → not armed");
  else fail("PS2 armed polling but has no RA support");
  if (!gating.steamGame) ok("Steam game → not armed (emulated-only)");
  else fail("Steam game armed polling");
  if (!gating.noPlatform) ok("Game with no platform → not armed");
  else fail("platform-less game armed polling");
}

console.log(`\n${"─".repeat(58)}`);
console.log(`RetroAchievements: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
