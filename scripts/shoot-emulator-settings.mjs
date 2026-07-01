#!/usr/bin/env node
/* global globalThis */
/**
 * Drives the real Electron app to the emulation settings and captures a
 * screenshot of every RALibretro core's Settings tab (and the Controls tab),
 * so we can eyeball that each core's options are wired and rendering.
 *
 * Seeds a fake "installed" config for each system (executablePath set) so the
 * Settings/Controls tabs appear, then deep-links to each console detail via
 * `#/settings?tab=emulation&system=<sys>` and clicks the tab.
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const OUT = path.resolve("scratch-shots");
fs.mkdirSync(OUT, { recursive: true });

// Fake installs on disk (exe existence only affects a status badge, not tabs).
const raDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-"));
fs.writeFileSync(path.join(raDir, "RALibretro.exe"), "x");
const cemuDir = fs.mkdtempSync(path.join(os.tmpdir(), "cemu-"));
fs.writeFileSync(path.join(cemuDir, "Cemu.exe"), "x");
const dolphinDir = fs.mkdtempSync(path.join(os.tmpdir(), "dol-"));
fs.writeFileSync(path.join(dolphinDir, "Dolphin.exe"), "x");

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron"),
  args: [path.resolve("out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60_000,
});
await app.firstWindow({ timeout: 40_000 });

// The main window only opens after the update-checker window closes. In the
// sandbox the network update check can hang, so force it to proceed.
const nonChecker = () =>
  app.windows().find((w) => {
    try {
      return !w.url().includes("update-checker");
    } catch {
      return false;
    }
  });
let win = null;
let proceeded = false;
for (let i = 0; i < 480; i++) {
  await new Promise((r) => setTimeout(r, 250));
  win = nonChecker();
  if (win) break;
  if (!proceeded && i > 8) {
    const checker = app.windows().find((w) => {
      try {
        return w.url().includes("update-checker");
      } catch {
        return false;
      }
    });
    if (checker) {
      proceeded = true;
      await checker
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

// Widen the window so the settings columns render at desktop size.
await app.evaluate(async ({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.setSize(1440, 960);
      w.center();
    } catch {
      /* ignore */
    }
  }
});

// Seed installed emulator configs so the Settings/Controls tabs render.
await app.evaluate(
  async (_, { raExe, cemuExe, dolphinExe }) => {
    const s = globalThis.__levelSublevels;
    const mk = (system, binary, exe) => ({
      system,
      binary,
      executablePath: exe,
      detectedVersion: "1.0-test",
      detectedAt: Date.now(),
      romFolders: [],
      lastScanAt: null,
      totalFiles: 0,
      totalSizeBytes: 0,
    });
    for (const sys of ["ps1", "psp", "gba", "n64", "nds", "dsi"])
      await s.emulatorsSublevel.put(sys, mk(sys, "ralibretro", raExe));
    await s.emulatorsSublevel.put("wiiu", mk("wiiu", "cemu", cemuExe));
    await s.emulatorsSublevel.put("gc", mk("gc", "dolphin", dolphinExe));
  },
  {
    raExe: path.join(raDir, "RALibretro.exe"),
    cemuExe: path.join(cemuDir, "Cemu.exe"),
    dolphinExe: path.join(dolphinDir, "Dolphin.exe"),
  }
);

// Dismiss the classics onboarding modal so it doesn't cover the page, and mark
// onboarding complete so the app renders straight to the UI.
await win.evaluate(() =>
  window.localStorage.setItem("hydra-classics-onboarding-dismissed", "true")
);
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

const clickTab = async (label) => {
  const tab = win.locator(`[role="tab"]`, { hasText: label }).first();
  await tab.waitFor({ state: "visible", timeout: 10_000 });
  await tab.click();
  await new Promise((r) => setTimeout(r, 600));
};

const shoot = async (system, tab, name) => {
  // Bounce through home so SettingsContextEmulation remounts and re-applies the
  // ?system deep link each time (HashRouter reacts to hash changes; no reload,
  // which would blank the renderer).
  await win.evaluate(() => {
    window.location.hash = "/";
  });
  await new Promise((r) => setTimeout(r, 500));
  await win.evaluate((sys) => {
    window.location.hash = `/settings?tab=emulation&system=${sys}`;
  }, system);
  await win
    .locator(".emulator-detail__hero-title")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  await clickTab(tab);
  const file = path.join(OUT, `${name}.png`);
  // Prefer an element-level shot of the settings/controls panel so the full
  // (inner-scrolling) list is captured, not just the viewport.
  const panel = win.locator(".emulator-settings, .controller-mapping").first();
  if (await panel.count().catch(() => 0)) {
    await panel.screenshot({ path: file }).catch(async () => {
      await win.screenshot({ path: file, fullPage: true });
    });
  } else {
    await win.screenshot({ path: file, fullPage: true });
  }
  console.log("  📸", file);
};

const SETTINGS_SHOTS = [
  ["n64", "settings-n64"],
  ["ps1", "settings-ps1"],
  ["psp", "settings-psp"],
  ["gba", "settings-gba"],
  ["nds", "settings-nds"],
  ["dsi", "settings-dsi"],
];

console.log("Capturing Settings tab per core:");
for (const [sys, name] of SETTINGS_SHOTS) {
  try {
    await shoot(sys, "Settings", name);
  } catch (e) {
    console.error("  ✗", sys, String(e).slice(0, 120));
  }
}

console.log("Capturing Controls tab:");
for (const [sys, name] of [
  ["n64", "controls-ralibretro"],
  ["wiiu", "controls-cemu"],
  ["gc", "controls-dolphin"],
]) {
  try {
    await shoot(sys, "Controls", name);
  } catch (e) {
    console.error("  ✗", sys, String(e).slice(0, 120));
  }
}

await app.close().catch(() => {});
console.log("Done. Shots in", OUT);
process.exit(0);
