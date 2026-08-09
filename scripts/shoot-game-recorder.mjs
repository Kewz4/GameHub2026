/* global globalThis */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightPackage) {
  throw new Error("Set PLAYWRIGHT_PACKAGE to Playwright's package directory.");
}

const { _electron: electron } = await import(
  pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
);
const electronExecutable = path.join(
  repositoryRoot,
  "node_modules",
  "electron",
  "dist",
  "electron.exe"
);
const mainEntry = path.join(repositoryRoot, "out", "main", "index.js");
const outputDirectory = path.join(repositoryRoot, "artifacts", "ui-qa");
const isolatedProfile = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-recorder-visual-qa-")
);

for (const required of [electronExecutable, mainEntry]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}
await fs.promises.mkdir(outputDirectory, { recursive: true });

const electronApp = await electron.launch({
  executablePath: electronExecutable,
  args: [
    mainEntry,
    "--no-sandbox",
    "--force-device-scale-factor=1",
    "--high-dpi-support=1",
  ],
  cwd: repositoryRoot,
  timeout: 60_000,
  env: {
    ...process.env,
    APPDATA: isolatedProfile,
    LOCALAPPDATA: isolatedProfile,
    PORTABLE_EXECUTABLE_DIR: isolatedProfile,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

try {
  await electronApp.firstWindow({ timeout: 40_000 });
  let window = null;
  let updateCheckerProceeded = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    window = electronApp.windows().find((candidate) => {
      try {
        const url = new URL(candidate.url());
        return (
          url.pathname.endsWith("/out/renderer/index.html") &&
          !url.hash.includes("update-checker") &&
          (url.hash === "" || url.hash.startsWith("#/"))
        );
      } catch {
        return false;
      }
    });
    if (window) break;

    if (!updateCheckerProceeded && attempt > 8) {
      const checker = electronApp.windows().find((candidate) => {
        try {
          return candidate.url().includes("update-checker");
        } catch {
          return false;
        }
      });
      if (checker) {
        updateCheckerProceeded = true;
        await checker
          .evaluate(() => globalThis.window.electron.updateCheckerProceed())
          .catch(() => undefined);
      }
    }
  }
  if (!window) throw new Error("The production GameHub window did not open.");

  await window.setViewportSize({ width: 1440, height: 1000 });
  await window.evaluate(async () => {
    localStorage.setItem("hydra-classics-onboarding-dismissed", "true");
    await globalThis.window.electron.updateUserPreferences({
      onboardingComplete: true,
      gameRecorderEnabled: true,
      gameRecorderResolution: "1080p",
      gameRecorderFps: 60,
      gameRecorderQualityPreset: "quality",
      gameRecorderInstantReplayEnabled: true,
      gameRecorderReplayDurationSeconds: 60,
      gameRecorderCaptureAudio: true,
    });
    location.hash = "/settings?tab=content_gameplay";
  });

  const captureHeading = window.locator("h3", { hasText: "Gameplay capture" });
  await captureHeading.waitFor({ state: "visible", timeout: 20_000 });
  const captureGroup = captureHeading.locator("..");
  const qualitySelect = captureGroup.getByLabel("Recording quality", {
    exact: true,
  });
  await qualitySelect.waitFor({ state: "visible" });
  if ((await qualitySelect.inputValue()) !== "quality") {
    throw new Error("High quality was not the selected recorder preset.");
  }
  await captureGroup
    .getByText(/Targets up to \d+ Mbps\./)
    .waitFor({ state: "visible" });
  await captureGroup
    .getByText(/Hardware video encoding is available\./)
    .waitFor({ state: "visible" });
  await captureGroup
    .getByText("Capture system audio (all apps while the game is active)", {
      exact: true,
    })
    .waitFor({ state: "visible" });

  const layout = await captureGroup.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  if (
    layout.left < 0 ||
    layout.right > layout.viewportWidth + 1 ||
    layout.documentWidth > layout.viewportWidth + 1
  ) {
    throw new Error(`Recorder settings overflowed: ${JSON.stringify(layout)}`);
  }

  await window.screenshot({
    path: path.join(outputDirectory, "game-recorder-settings.png"),
    fullPage: true,
  });
} finally {
  await electronApp.close().catch(() => undefined);
  await fs.promises
    .rm(isolatedProfile, { recursive: true, force: true })
    .catch(() => undefined);
}
