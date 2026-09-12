import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const { _electron: electron } = await import(
  pathToFileURL(path.join(process.env.PLAYWRIGHT_PACKAGE, "index.mjs")).href
);
const output = path.join(
  root,
  "artifacts",
  "maintenance-202609",
  `installer-${Date.now()}`
);
fs.mkdirSync(output, { recursive: true });
const report = { pageErrors: [], checks: [], screenshots: [] };
let app;
try {
  app = await electron.launch({
    executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "web-setup-electron/main.js")],
    cwd: root,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page
    .getByRole("button", { name: "Install GameHub", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.getElementById("mode-install").disabled,
    { timeout: 30000 }
  );
  await page.evaluate(() => document.fonts.ready);
  assert.match(
    await page.locator("#version").innerText(),
    /Latest release: v?\d/
  );
  assert.equal(
    await page
      .locator(".brand-mark")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true
  );
  await page.screenshot({
    path: path.join(output, "installer-live-release.png"),
  });
  report.screenshots.push("installer-live-release.png");
  report.checks.push(
    "Live GitHub release lookup, bundled font, logo, initial actions"
  );
  await page
    .getByRole("button", { name: "Install GameHub", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "mode-portable"
  );
  report.checks.push("Keyboard navigation between installation choices");
  // Deterministic event fixtures cover renderer states without installing over
  // the user's app. Download verification itself is tested in download.test.cjs.
  await page.evaluate(() => globalThis.showScreen("progress"));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.send("setup:status", "Downloading GameHub…");
    window.webContents.send("setup:progress", {
      downloaded: 65 * 1024 * 1024,
      total: 100 * 1024 * 1024,
      percent: 65,
    });
  });
  await page.waitForFunction(
    () => document.getElementById("progress-percent").textContent === "65%"
  );
  assert.equal(
    await page.getByRole("progressbar").getAttribute("aria-valuenow"),
    "65"
  );
  await page.screenshot({
    path: path.join(output, "installer-progress-fixture.png"),
  });
  report.screenshots.push("installer-progress-fixture.png");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send(
      "setup:error",
      "The download did not match the release checksum. Try again."
    )
  );
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  assert.equal(await page.locator("#progress-percent").textContent(), "0%");
  assert.equal(await page.locator("#screen-select").isVisible(), true);
  report.checks.push(
    "Progress accessibility, checksum error presentation and retry reset (event fixtures)"
  );
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
