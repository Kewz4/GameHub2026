#!/usr/bin/env node
/**
 * End-to-end smoke test for the built GameHub Electron app.
 *
 * Launches the app headlessly via Playwright's Electron driver and asserts the
 * first renderer window actually paints (catches blank-window regressions).
 *
 * Prerequisites:
 *   1. Build the app first WITH the CI env vars (see
 *      docs/testing-with-playwright-electron.md), e.g.:
 *        MAIN_VITE_API_URL=https://hydra-api-us-east-1.losbroxas.org \
 *        ... npx electron-vite build
 *   2. Run under a virtual display:
 *        xvfb-run -a node scripts/smoke-test.mjs
 *
 * Exits non-zero if the app fails to launch, the window never paints, or the
 * renderer throws an uncaught error during bootstrap.
 */
import path from "node:path";
import { existsSync } from "node:fs";

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_MODULE_PATH ??
  "/opt/node22/lib/node_modules/playwright/index.mjs";

const { _electron: electron } = await import(PLAYWRIGHT);

const electronPath = path.resolve("node_modules/electron/dist/electron");
const mainEntry = path.resolve("out/main/index.js");

if (!existsSync(mainEntry)) {
  console.error(
    `✗ ${mainEntry} not found — run "npx electron-vite build" first.`
  );
  process.exit(2);
}

const app = await electron.launch({
  executablePath: electronPath,
  // --no-sandbox is required when running as root (CI / sandbox).
  args: [mainEntry, "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 60000,
});
console.log("✓ Electron launched");

let rendererError = null;
const win = await app.firstWindow({ timeout: 40000 });
win.on("pageerror", (e) => (rendererError = String(e)));
win.on("console", (m) => {
  if (m.type() === "error") console.log("  [console.error]", m.text());
});
console.log("✓ first window:", win.url());

try {
  await win.waitForFunction(
    () =>
      (document.getElementById("root") || document.body).innerText.trim()
        .length > 0,
    { timeout: 15000 }
  );
} catch {
  console.error("✗ renderer never painted any text within 15s");
  if (rendererError) console.error("  renderer error:", rendererError);
  await app.close().catch(() => {});
  process.exit(1);
}

const text = await win.evaluate(() =>
  (document.getElementById("root") || document.body).innerText
    .replace(/\s+/g, " ")
    .slice(0, 160)
);
console.log("✓ renderer painted:", JSON.stringify(text));

await win
  .screenshot({ path: "smoke.png" })
  .then(() => console.log("✓ screenshot saved to smoke.png"))
  .catch(() => {});

await app.close();

if (rendererError) {
  console.error("✗ renderer threw during bootstrap:", rendererError);
  process.exit(1);
}
console.log("✓ smoke test passed");
