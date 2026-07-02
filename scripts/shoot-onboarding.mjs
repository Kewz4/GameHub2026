#!/usr/bin/env node
/**
 * Walks the first-run onboarding and screenshots each step (1920x1080),
 * flagging the Achievements/Exophase step and the Emulators-logos step.
 */
import { _electron as electron } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve("scratch-shots/onboarding");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

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
// The onboarding window is sized 960x680 by the app itself — capture at that
// real size so the layout assessment reflects what the user actually sees.
await win.setViewportSize({ width: 960, height: 680 }).catch(() => {});

// Force onboarding to show (clear the completed flag) and land on the app root.
await win.evaluate(() =>
  window.electron.updateUserPreferences({ onboardingComplete: false })
);
await win.evaluate(() => {
  window.location.hash = "/";
});
await win.reload();
await new Promise((r) => setTimeout(r, 6000));

// Use evaluate (not a Playwright locator) so no highlight overlay is injected
// into the page before we screenshot it.
const activeStep = () =>
  win
    .evaluate(
      () =>
        document.querySelector(
          ".onboarding-nav-item--active .onboarding-nav-item__label"
        )?.textContent ?? ""
    )
    .catch(() => "");

// Playwright injects a translucent highlight overlay (<x-pw-glass>, plus the
// "body 960×680" size badge) when locators run; it tints the whole capture.
// Strip it right before each screenshot so shots reflect the real UI.
const clearHighlight = () =>
  win
    .evaluate(() => {
      document
        .querySelectorAll("x-pw-glass, x-pw-tooltip, x-pw-highlight")
        .forEach((el) => el.remove());
    })
    .catch(() => {});

const shoot = async (file) => {
  await clearHighlight();
  await win.screenshot({ path: file }).catch(() => {});
};

// The primary advance control varies per step (Get started / Next / Skip /
// Continue). Click the first visible one that matches.
const advance = async () => {
  const labels = [
    "Get started",
    "Continue",
    "Next",
    "Skip",
    "Skip for now",
    "Maybe later",
    "Finish",
  ];
  for (const label of labels) {
    const btn = win.locator(`button:has-text("${label}")`).first();
    if (
      (await btn.count().catch(() => 0)) &&
      (await btn.isVisible().catch(() => false))
    ) {
      await btn.click().catch(() => {});
      return label;
    }
  }
  return null;
};

const seen = new Set();
let shotAchievements = false;
let shotEmulators = false;

for (let step = 0; step < 22; step++) {
  await new Promise((r) => setTimeout(r, 2500));
  const label = (await activeStep()) || `step${step}`;

  const safe =
    label.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || `step${step}`;
  const file = path.join(OUT, `${String(step).padStart(2, "0")}-${safe}.png`);
  await shoot(file);

  // Classify by the active nav label — the RA card's copy mentions
  // "RALibretro", so body-text matching would misflag the Achievements step.
  const isEmu = label === "Emulators";
  const isAch = label === "Achievements";
  if (isAch && !shotAchievements) {
    await shoot(path.join(OUT, "STEP-achievements.png"));
    shotAchievements = true;
    console.log(`  📸 achievements/exophase (nav="${label}")`);
  }
  if (isEmu && !shotEmulators) {
    await shoot(path.join(OUT, "STEP-emulators.png"));
    shotEmulators = true;
    console.log(`  📸 emulators logos (nav="${label}")`);
  }

  console.log(`  step ${step}: nav="${label}"`);
  if (shotEmulators) break; // emulators is the target end

  const clicked = await advance();
  const key = `${label}:${clicked}`;
  if (!clicked || seen.has(key)) {
    // Stuck (no advance button, or looping) — stop.
    console.log(`  (stopping: clicked=${clicked})`);
    break;
  }
  seen.add(key);
}

console.log(
  `Done. achievements=${shotAchievements} emulators=${shotEmulators}. Shots in ${OUT}`
);
await app.close().catch(() => {});
process.exit(0);
