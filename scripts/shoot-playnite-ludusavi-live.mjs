/* global globalThis */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightPackage) {
  throw new Error("Set PLAYWRIGHT_PACKAGE to Playwright's package directory.");
}
const requiredEnvironmentPath = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the live clone harness.`);
  return path.resolve(value);
};
const sourceData = requiredEnvironmentPath("GAMEHUB_LIVE_DATA");
const playniteDb = requiredEnvironmentPath("GAMEHUB_PLAYNITE_DB_PATH");
const backupRoot =
  process.env.GAMEHUB_LUDUSAVI_BACKUPS ?? path.join(sourceData, "Backups");
const installedAsar = path.join(
  path.dirname(sourceData),
  "resources",
  "app.asar"
);

for (const required of [
  playwrightPackage,
  playniteDb,
  backupRoot,
  installedAsar,
  path.join(repositoryRoot, "out", "main", "index.js"),
]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}

// electron-vite preview resolves the native addon relative to out/main. Mirror
// only the already-built runtime bundle into that generated directory, matching
// the other live QA harnesses without changing production resolution behavior.
await fs.promises.cp(
  path.join(repositoryRoot, "hydra-native"),
  path.join(repositoryRoot, "out", "main", "hydra-native"),
  { recursive: true }
);

const { extractFile } = await import("@electron/asar");
const installedMain = extractFile(
  installedAsar,
  "out\\main\\index.js"
).toString("utf8");
const r2MarkerIndex = installedMain.indexOf(
  "r2_credentials_broker_not_configured"
);
const r2Nearby = installedMain.slice(
  Math.max(0, r2MarkerIndex - 12_000),
  r2MarkerIndex + 1_000
);
const r2CredentialsUrl = [...r2Nearby.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
  .map((match) => match[0])
  .find((candidate) => {
    try {
      return new URL(candidate).hostname.endsWith(".workers.dev");
    } catch {
      return false;
    }
  });
if (!r2CredentialsUrl) {
  throw new Error("Unable to discover the R2 credential broker URL.");
}
const markerIndex = installedMain.indexOf("/auth/refresh");
const nearby = installedMain.slice(
  Math.max(0, markerIndex - 8_000),
  markerIndex + 8_000
);
const hydraApiUrl = [...nearby.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
  .map((match) => match[0])
  .find((candidate) => {
    try {
      const url = new URL(candidate);
      return (
        !url.hostname.endsWith(".workers.dev") &&
        !url.hostname.endsWith(".cloudflarestorage.com")
      );
    } catch {
      return false;
    }
  });
if (!hydraApiUrl) throw new Error("Unable to discover the Hydra API URL.");

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
const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-playnite-ludusavi-")
);
const isolatedData = path.join(isolatedRoot, "data");
fs.mkdirSync(isolatedData, { recursive: true });
for (const folder of ["gamehub-db", "ludusavi"]) {
  const source = path.join(sourceData, folder);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(isolatedData, folder), {
    recursive: true,
    filter: (entry) => path.basename(entry).toUpperCase() !== "LOCK",
  });
}

const outputDirectory = path.join(
  repositoryRoot,
  "artifacts",
  "playnite-ludusavi"
);
fs.mkdirSync(outputDirectory, { recursive: true });

const app = await electron.launch({
  executablePath: electronExecutable,
  args: [
    path.join(repositoryRoot, "out", "main", "index.js"),
    "--no-sandbox",
    "--force-device-scale-factor=1",
  ],
  cwd: repositoryRoot,
  timeout: 60_000,
  env: {
    ...process.env,
    PORTABLE_EXECUTABLE_DIR: isolatedRoot,
    GAMEHUB_API_URL: hydraApiUrl,
    GAMEHUB_R2_CREDENTIALS_URL: r2CredentialsUrl,
    GAMEHUB_PLAYNITE_DB_PATH: playniteDb,
    GAMEHUB_READ_ONLY_VISUAL_QA: "true",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

const findMainWindow = async () => {
  await app.firstWindow({ timeout: 40_000 });
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const main = app.windows().find((candidate) => {
      const url = candidate.url();
      return (
        url.includes("out/renderer/index.html") &&
        !url.includes("update-checker") &&
        !url.includes("achievement-notification")
      );
    });
    if (main) return main;
    const checker = app
      .windows()
      .find((candidate) => candidate.url().includes("update-checker"));
    if (checker && attempt > 8) {
      await checker
        .evaluate(() => globalThis.window.electron.updateCheckerProceed())
        .catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("GameHub main window did not open.");
};

const readCloneState = () =>
  app.evaluate(async () => ({
    games: (
      await globalThis.__levelSublevels.gamesSublevel.iterator().all()
    ).map(([key, game]) => ({
      key,
      title: game.title,
      shop: game.shop,
      objectId: game.objectId,
      isDeleted: game.isDeleted,
      playTimeInMilliseconds: game.playTimeInMilliseconds ?? 0,
      pendingAbsolutePlayTimeInMilliseconds:
        game.pendingAbsolutePlayTimeInMilliseconds ?? null,
    })),
  }));

try {
  const window = await findMainWindow();
  await window.waitForFunction(
    () => (document.getElementById("root")?.innerText.length ?? 0) > 10,
    undefined,
    { timeout: 30_000 }
  );
  const user = await window.evaluate(() => globalThis.window.electron.getMe());
  assert.ok(
    user?.id && user.displayName?.trim(),
    "expected an authenticated cloned account session"
  );

  const before = await readCloneState();
  const scanEntries = await window.evaluate(
    (root) => globalThis.window.electron.scanLudusaviBackupFolder(root),
    backupRoot
  );
  assert.equal(
    scanEntries.length,
    10,
    "all real nested Ludusavi backups found"
  );
  const pcTargets = new Set(["1145350", "1817070", "2680010"]);
  const previews = [];
  const localDetails = [];
  for (const entry of scanEntries.filter((candidate) =>
    pcTargets.has(candidate.suggestedGame?.objectId ?? "")
  )) {
    const details = await window.evaluate(
      ({ objectId, shop }) =>
        globalThis.window.electron.getCloudSaveV2FileDetails(objectId, shop),
      {
        objectId: entry.suggestedGame.objectId,
        shop: entry.suggestedGame.shop,
      }
    );
    localDetails.push({
      title: entry.suggestedGame.title,
      shop: entry.suggestedGame.shop,
      objectId: entry.suggestedGame.objectId,
      localFileCount: details.local.fileCount,
      localTotalSizeBytes: details.local.totalSizeBytes,
      localRawPaths: [
        ...new Set(details.local.files.map((file) => file.rawPath)),
      ].sort(),
      nativeUsesExtendedWindowsPaths: details.local.files.some((file) =>
        file.absolutePath.replaceAll("\\", "/").startsWith("//?/")
      ),
      activeSnapshotFileCount: details.activeSnapshot?.fileCount ?? 0,
    });
    const preview = await window
      .evaluate(
        ({ entry }) =>
          globalThis.window.electron.importLudusaviBackup(
            entry.folderPath,
            entry.suggestedGame.objectId,
            entry.suggestedGame.shop,
            { dryRun: true }
          ),
        { entry }
      )
      .then((result) => ({
        title: entry.suggestedGame.title,
        shop: entry.suggestedGame.shop,
        objectId: entry.suggestedGame.objectId,
        result,
        error: null,
      }))
      .catch((error) => ({
        title: entry.suggestedGame.title,
        shop: entry.suggestedGame.shop,
        objectId: entry.suggestedGame.objectId,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      }));
    previews.push(preview);
  }
  assert.equal(previews.length, 3, "Hades II, Spider-Man, and Khazan matched");

  await window.evaluate(() => {
    globalThis.location.hash = "#/settings?tab=integrations";
  });
  await window.getByRole("heading", { name: "Integrations" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await window
    .getByRole("button", { name: /Import Playnite Playtime/ })
    .click();
  await window.getByRole("button", { name: "Auto-detect & Import" }).click();
  await window
    .getByRole("heading", { name: "Playnite Import Results" })
    .waitFor({ state: "visible", timeout: 120_000 });
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.screenshot({
    path: path.join(outputDirectory, "playnite-import-live-clone.png"),
    fullPage: true,
  });

  const modalText = await window.locator("body").innerText();
  assert.match(modalText, /updated/i);
  assert.match(modalText, /protected/i);
  assert.match(modalText, /saved for later/i);
  const cachedCount = Number(
    modalText.match(/(\d+)\s+saved for later/i)?.[1] ?? 0
  );
  assert.ok(cachedCount > 0, "unadded Playnite games are retained");

  await window.getByText("Close", { exact: true }).click();
  const after = await readCloneState();
  const beforeActive = before.games.filter((game) => !game.isDeleted);
  const afterByKey = new Map(after.games.map((game) => [game.key, game]));
  const protectedChanges = beforeActive
    .filter((game) => game.playTimeInMilliseconds >= 5 * 60 * 60 * 1000)
    .filter(
      (game) =>
        afterByKey.get(game.key)?.playTimeInMilliseconds !==
        game.playTimeInMilliseconds
    );
  assert.deepEqual(protectedChanges, [], "five-hour values stay untouched");
  await window.getByRole("button", { name: /Import Ludusavi Backup/ }).click();
  const originalDialog = await app.evaluate(
    async ({ dialog }, selectedPath) => {
      const original = dialog.showOpenDialog;
      globalThis.__gamehubRestoreOpenDialog = () => {
        dialog.showOpenDialog = original;
      };
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      });
      return true;
    },
    backupRoot
  );
  assert.equal(originalDialog, true);
  await window.getByRole("button", { name: "Pick Backup Folder" }).click();
  await window.waitForFunction(
    () => document.body.innerText.includes("Found 10 verified backups"),
    undefined,
    { timeout: 30_000 }
  );
  await window.screenshot({
    path: path.join(outputDirectory, "ludusavi-import-live-clone.png"),
    fullPage: true,
  });
  await app
    .evaluate(() => globalThis.__gamehubRestoreOpenDialog?.())
    .catch(() => undefined);

  const report = {
    authenticatedAccount: true,
    checkedAt: new Date().toISOString(),
    playnite: {
      activeGamesBefore: beforeActive.length,
      protectedGamesChecked: beforeActive.filter(
        (game) => game.playTimeInMilliseconds >= 5 * 60 * 60 * 1000
      ).length,
      protectedChanges: protectedChanges.length,
      cachedForFutureLibraryAdds: cachedCount,
      pendingAbsoluteCloudSyncsInReadOnlyClone: after.games.filter(
        (game) => game.pendingAbsolutePlayTimeInMilliseconds != null
      ).length,
    },
    ludusavi: {
      discovered: scanEntries.length,
      suggestedMatches: scanEntries.filter((entry) => entry.suggestedGame)
        .length,
      localDetails,
      previews,
    },
  };
  const reportPath = path.join(outputDirectory, "live-clone-report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        ...report,
        reportPath: path.relative(repositoryRoot, reportPath),
      },
      null,
      2
    )
  );
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
}
