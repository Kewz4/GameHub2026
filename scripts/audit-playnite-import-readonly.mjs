/* global globalThis */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ClassicLevel } from "classic-level";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightPackage) {
  throw new Error("Set PLAYWRIGHT_PACKAGE to Playwright's package directory.");
}

const sourceData = process.env.GAMEHUB_LIVE_DATA;
const playniteDb = process.env.GAMEHUB_PLAYNITE_DB_PATH;
if (!sourceData || !playniteDb) {
  throw new Error(
    "Set GAMEHUB_LIVE_DATA and GAMEHUB_PLAYNITE_DB_PATH explicitly."
  );
}
const sourceDb = path.join(sourceData, "gamehub-db");
const installedAsar = path.join(
  path.dirname(sourceData),
  "resources",
  "app.asar"
);

for (const required of [
  playwrightPackage,
  sourceDb,
  playniteDb,
  installedAsar,
  path.join(repositoryRoot, "out", "main", "index.js"),
]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}

const hashFile = (filePath) =>
  createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const hashDatabase = (directory) =>
  Object.fromEntries(
    fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== "LOCK")
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => [entry.name, hashFile(path.join(directory, entry.name))])
  );

const sourceHashesBefore = hashDatabase(sourceDb);
const playniteHashBefore = hashFile(playniteDb);

const { extractFile } = await import("@electron/asar");
const installedMain = extractFile(
  installedAsar,
  "out\\main\\index.js"
).toString("utf8");
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

const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-playnite-")
);
const isolatedData = path.join(isolatedRoot, "data");
const isolatedDb = path.join(isolatedData, "gamehub-db");
fs.mkdirSync(isolatedData, { recursive: true });
fs.cpSync(sourceDb, isolatedDb, {
  recursive: true,
  filter: (entry) => path.basename(entry).toUpperCase() !== "LOCK",
});

// Remove auth only from the disposable clone. Catalogue reads are public, and
// running signed out makes it impossible for startup/background work to mutate
// the user's Hydra profile during this audit.
const cloneLevel = new ClassicLevel(isolatedDb, { valueEncoding: "json" });
await cloneLevel.open();
await cloneLevel.del("auth").catch(() => undefined);
await cloneLevel.del("user").catch(() => undefined);
await cloneLevel.close();

const { _electron: electron } = await import(
  pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
);
const app = await electron.launch({
  executablePath: path.join(
    repositoryRoot,
    "node_modules",
    "electron",
    "dist",
    "electron.exe"
  ),
  args: [path.join(repositoryRoot, "out", "main", "index.js"), "--no-sandbox"],
  cwd: repositoryRoot,
  timeout: 60_000,
  env: {
    ...process.env,
    APPDATA: isolatedRoot,
    LOCALAPPDATA: isolatedRoot,
    PORTABLE_EXECUTABLE_DIR: isolatedRoot,
    GAMEHUB_API_URL: hydraApiUrl,
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

const readCloneGames = () =>
  app.evaluate(async () =>
    (await globalThis.__levelSublevels.gamesSublevel.iterator().all()).map(
      ([key, game]) => ({
        key,
        title: game.title,
        shop: game.shop,
        objectId: game.objectId,
        remoteId: game.remoteId ?? null,
        libraryOrigin: game.libraryOrigin ?? null,
        isDeleted: game.isDeleted,
        playTimeInMilliseconds: game.playTimeInMilliseconds ?? 0,
        pendingAbsolutePlayTimeInMilliseconds:
          game.pendingAbsolutePlayTimeInMilliseconds ?? null,
      })
    )
  );

try {
  const window = await findMainWindow();
  const before = await readCloneGames();
  const result = await window.evaluate(
    (databasePath) =>
      globalThis.window.electron.importPlaynitePlaytime(databasePath, {
        syncCloud: false,
      }),
    playniteDb
  );
  const after = await readCloneGames();

  const beforeActive = before.filter((game) => !game.isDeleted);
  const afterByKey = new Map(after.map((game) => [game.key, game]));
  const changed = beforeActive
    .filter(
      (game) =>
        afterByKey.get(game.key)?.playTimeInMilliseconds !==
        game.playTimeInMilliseconds
    )
    .map((game) => ({
      ...afterByKey.get(game.key),
      previousPlayTimeInMilliseconds: game.playTimeInMilliseconds,
    }));
  const protectedGames = beforeActive.filter(
    (game) => game.playTimeInMilliseconds >= 5 * 60 * 60 * 1000
  );
  const protectedChanges = changed.filter(
    (game) => game.previousPlayTimeInMilliseconds >= 5 * 60 * 60 * 1000
  );

  assert.equal(result.cloudSynced, 0, "read-only audit must not sync Hydra");
  assert.equal(
    result.cloudSyncPending,
    result.matched,
    "every changed value stays durably pending while cloud sync is disabled"
  );
  assert.equal(
    changed.length,
    result.matched,
    "changed rows match result count"
  );
  assert.deepEqual(protectedChanges, [], "five-hour values stay untouched");
  assert.ok(
    changed.every(
      (game) =>
        game.previousPlayTimeInMilliseconds < 5 * 60 * 60 * 1000 &&
        game.pendingAbsolutePlayTimeInMilliseconds ===
          game.playTimeInMilliseconds
    ),
    "all sub-five-hour replacements are exact and durably queued"
  );
  assert.equal(
    result.total,
    result.matched + result.preserved.length + result.cached.length,
    "every parsed Playnite title is updated, protected/equal, or retained"
  );

  const pending = after
    .filter((game) => game.pendingAbsolutePlayTimeInMilliseconds != null)
    .map((game) => ({
      title: game.title,
      shop: game.shop,
      objectId: game.objectId,
      remoteId: game.remoteId,
      libraryOrigin: game.libraryOrigin,
      playTimeInMilliseconds: game.playTimeInMilliseconds,
      pendingAbsolutePlayTimeInMilliseconds:
        game.pendingAbsolutePlayTimeInMilliseconds,
    }));
  const report = {
    checkedAt: new Date().toISOString(),
    isolation: {
      sourceGameHubDatabaseUnchanged: true,
      sourcePlayniteDatabaseUnchanged: true,
      hydraSignedOutInClone: true,
      hydraWritesEnabled: false,
    },
    activeGamesBefore: beforeActive.length,
    playniteTitlesWithPlaytime: result.total,
    updatedBelowFiveHours: result.matched,
    preservedOrAlreadyEqual: result.preserved.length,
    protectedLibraryGamesChecked: protectedGames.length,
    protectedChanges: protectedChanges.length,
    cachedForFutureLibraryAdds: result.cached.length,
    catalogueResolvedCaches: result.cached.filter(
      (game) => game.catalogueMatched
    ).length,
    unresolvedButRetainedCaches: result.cached.filter(
      (game) => !game.catalogueMatched
    ).length,
    changed,
    pending,
  };

  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts",
    "playnite-ludusavi"
  );
  fs.mkdirSync(outputDirectory, { recursive: true });
  const reportPath = path.join(
    outputDirectory,
    "playnite-live-readonly-report.json"
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} finally {
  await app.close().catch(() => undefined);
  assert.deepEqual(
    hashDatabase(sourceDb),
    sourceHashesBefore,
    "source GameHub database changed during isolated audit"
  );
  assert.equal(
    hashFile(playniteDb),
    playniteHashBefore,
    "source Playnite database changed during isolated audit"
  );
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
}
