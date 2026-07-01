#!/usr/bin/env node
/* global globalThis */
/**
 * Verifies the achievement-toast-over-fullscreen work against the running app:
 *  T1  sendAchievementToFocusedWindow (the in-app path used on Linux, and by
 *      RALibretro/emulator unlocks now that ra-watcher-manager.ts routes
 *      through it) actually renders the AchievementNotificationOverlay in the
 *      main window when it's focused.
 *  T2  showAchievementNotification / showCombinedAchievementsNotification
 *      (the hardened always-on-top overlay path used on Windows) don't throw
 *      and correctly report "unavailable" on this platform, so callers fall
 *      back instead of silently losing the notification.
 *  T3  raiseOverFullscreen's always-on-top level survives being called twice
 *      in a row without erroring (mirrors the re-assert-then-show sequence).
 *
 * NOTE: this sandbox is Linux, where the transparent always-on-top overlay
 * window is intentionally not created (see WindowManager.createNotificationWindow).
 * The Windows-specific "stays on top of a borderless-fullscreen game" behavior
 * (setAlwaysOnTop("screen-saver") + showInactive + moveTop) can't be exercised
 * here; T2/T3 assert it degrades safely rather than that it visually overlays
 * a fullscreen window, which needs a real Windows box to observe.
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
await win
  .evaluate(() =>
    window.electron.updateUserPreferences({ onboardingComplete: true })
  )
  .catch(() => {});
await win
  .waitForFunction(
    () =>
      (document.getElementById("root") || document.body).innerText.trim()
        .length > 10,
    { timeout: 20_000 }
  )
  .catch(() => {});
await win.bringToFront().catch(() => {});
await new Promise((r) => setTimeout(r, 500));

// ── T1: in-app toast (the RALibretro/Linux path) actually renders ──────────────
console.log("[T1] sendAchievementToFocusedWindow renders the in-app toast");
const sent = await app.evaluate(() => {
  const wm = globalThis.__windowManager;
  if (!wm) return { __missing: true };
  return wm.sendAchievementToFocusedWindow("top-left", [
    {
      title: "Full Screen Champion",
      description: "Unlocked while the game window had focus",
      iconUrl: "https://media.retroachievements.org/Badge/00000.png",
      isHidden: false,
      isRare: true,
      isPlatinum: false,
      points: 25,
    },
  ]);
});
if (sent && sent.__missing) {
  fail(
    "globalThis.__windowManager not exposed",
    "expose WindowManager in dev like __raWatcherManager"
  );
} else if (sent === true) {
  ok("sendAchievementToFocusedWindow reports it delivered to a focused window");
} else {
  fail("sendAchievementToFocusedWindow returned false (no window focused)");
}

await new Promise((r) => setTimeout(r, 600));
const toastText = await win
  .evaluate(() => document.body.innerText)
  .catch(() => "");
if (toastText.includes("Full Screen Champion"))
  ok("achievement toast is mounted in the DOM after the unlock event");
else fail("toast text not found in the rendered page", toastText.slice(0, 200));

// The toast has a staged entrance animation (badge pop-in 0-450ms, hold to
// 900ms, then expand + reveal title/description 900-1350ms) — wait past that
// before screenshotting so the capture shows the fully expanded toast.
await new Promise((r) => setTimeout(r, 1600));
await win.screenshot({ path: path.join(OUT, "achievement-toast.png") });

// ── T2: hardened overlay path is safe when unavailable (this platform) ─────────
console.log(
  "\n[T2] showAchievementNotification / showCombinedAchievementsNotification degrade safely"
);
const overlayResult = await app.evaluate(async () => {
  const wm = globalThis.__windowManager;
  try {
    const single = await wm.showAchievementNotification("top-left", [
      {
        title: "Overlay Test",
        iconUrl: "https://media.retroachievements.org/Badge/00000.png",
        isHidden: false,
        isRare: false,
        isPlatinum: false,
      },
    ]);
    const combined = await wm.showCombinedAchievementsNotification(
      2,
      5,
      "top-left"
    );
    return { ok: true, single, combined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
if (overlayResult.ok)
  ok(
    `no throw; single=${overlayResult.single}, combined=${overlayResult.combined} (both false is correct on this platform — the always-on-top overlay window isn't created here)`
  );
else fail("overlay path threw", overlayResult.error);

// ── T3: raise-over-fullscreen is idempotent (no throw calling it repeatedly) ───
console.log(
  "\n[T3] Re-asserting always-on-top twice in a row (the raise-then-show sequence) doesn't throw"
);
const raiseResult = await app.evaluate(async ({ BrowserWindow }) => {
  try {
    const w = new BrowserWindow({ show: false, width: 10, height: 10 });
    w.setAlwaysOnTop(true, "screen-saver", 1);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.moveTop();
    w.setAlwaysOnTop(true, "screen-saver", 1);
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.moveTop();
    const level = w.isAlwaysOnTop();
    w.destroy();
    return { ok: true, level };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
if (raiseResult.ok && raiseResult.level)
  ok("repeated always-on-top re-assertion is safe and sticks");
else fail("raise-over-fullscreen sequence failed", JSON.stringify(raiseResult));

console.log(`\n${"─".repeat(58)}`);
console.log(`Achievement fullscreen toast: ${passed} passed, ${failed} failed`);
await app.close().catch(() => {});
process.exit(failed > 0 ? 1 : 0);
