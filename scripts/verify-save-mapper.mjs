#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceData = process.env.GAMEHUB_TEST_DATA;
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!sourceData || !playwrightPackage) {
  throw new Error(
    "Set GAMEHUB_TEST_DATA to a GameHub data folder and PLAYWRIGHT_PACKAGE to Playwright's package directory."
  );
}

const { _electron: electron } = await import(
  pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
);
const executablePath = path.join(
  repositoryRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const mainEntry = path.join(repositoryRoot, "out", "main", "index.js");
for (const required of [
  executablePath,
  mainEntry,
  path.join(sourceData, "gamehub-db"),
  path.join(sourceData, "ludusavi"),
]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}

// Never point the test app at live GameHub state. It may update its Ludusavi
// config while generating previews, so clone only the database and mapper data.
const portableRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-save-mapper-")
);
const clonedData = path.join(portableRoot, "data");
fs.mkdirSync(clonedData, { recursive: true });
for (const folder of ["gamehub-db", "ludusavi"]) {
  fs.cpSync(path.join(sourceData, folder), path.join(clonedData, folder), {
    recursive: true,
    // LevelDB holds LOCK exclusively while the real launcher is open. The lock
    // contains no data; immutable tables, CURRENT, and MANIFEST form the clone.
    filter: (source) => path.basename(source).toUpperCase() !== "LOCK",
  });
}

const normalize = (value) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
const results = [];
const failures = [];
const reportPath = path.join(
  repositoryRoot,
  "artifacts",
  "save-mapper",
  "live-report.json"
);
const app = await electron.launch({
  executablePath,
  args: [mainEntry, "--no-sandbox"],
  cwd: repositoryRoot,
  timeout: 60_000,
  env: {
    ...process.env,
    PORTABLE_EXECUTABLE_DIR: portableRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

const fail = (message) => failures.push(message);

try {
  await app.firstWindow({ timeout: 40_000 });
  const getMainWindow = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const mainWindowId = await app
        .evaluate(async () => {
          const windowManager = global.__windowManager;
          if (
            windowManager &&
            (!windowManager.mainWindow ||
              windowManager.mainWindow.isDestroyed())
          ) {
            await windowManager.createMainWindow();
          }

          const mainWindow = windowManager?.mainWindow;
          return mainWindow && !mainWindow.isDestroyed() ? mainWindow.id : null;
        })
        .catch(() => null);

      if (mainWindowId !== null) {
        for (const candidate of app.windows()) {
          if (candidate.isClosed()) continue;

          const handle = await app.browserWindow(candidate).catch(() => null);
          let candidateWindowId = null;
          try {
            candidateWindowId = await handle
              ?.evaluate((browserWindow) => browserWindow.id)
              .catch(() => null);
          } finally {
            await handle?.dispose().catch(() => {});
          }
          if (candidateWindowId === mainWindowId) return candidate;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
  };

  let window = await getMainWindow();
  if (!window) {
    const windows = await Promise.all(
      app.windows().map(async (entry) => ({
        url: entry.url(),
        text: await entry
          .evaluate(() => document.body?.innerText?.slice(0, 500) ?? "")
          .catch(() => "<unreadable>"),
      }))
    );
    throw new Error(
      `No GameHub library window appeared: ${JSON.stringify(windows)}`
    );
  }

  const evaluateMain = async (pageFunction, argument) => {
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      window = await getMainWindow();
      if (!window) {
        lastError = new Error("The persistent GameHub main window closed");
        continue;
      }

      try {
        return await window.evaluate(pageFunction, argument);
      } catch (error) {
        lastError = error;
        if (
          !/Target page.*closed|context or browser has been closed|Execution context was destroyed/i.test(
            String(error)
          )
        ) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error("Unable to evaluate the GameHub main window");
  };

  const library = await evaluateMain(() => window.electron.getLibrary());
  const active = library.filter((game) => !game.isDeleted);

  const pcTargets = [
    {
      shop: "steam",
      objectId: "1135230",
      label: "Ember Knights",
      path: "EmberKnights_64_Data\\SaveData",
      data: true,
    },
    {
      shop: "steam",
      objectId: "1145350",
      label: "Hades II",
      path: "Saved Games\\Hades II",
      data: true,
    },
    {
      shop: "steam",
      objectId: "2334730",
      label: "Death Must Die",
      path: "Realm Archive\\Death Must Die",
      data: true,
    },
    {
      shop: "steam",
      objectId: "2680010",
      label: "Khazan",
      path: "BBQ",
      data: true,
    },
    {
      shop: "steam",
      objectId: "2444750",
      label: "Shape of Dreams",
      path: "Shape of Dreams",
      data: true,
    },
    {
      shop: "steam",
      objectId: "2071280",
      label: "Ravenswatch",
      path: "Ravenswatch\\_Save",
      data: true,
    },
    {
      shop: "epic",
      objectId: "a26f991a5e6c4e9c9572fc200cbea47f",
      label: "Neon Abyss",
      path: "NeonAbyss\\SavesDir",
      data: true,
    },
    {
      shop: "riot",
      objectId: "league_of_legends",
      label: "League of Legends",
      path: "League of Legends\\Config",
      data: true,
    },
    {
      shop: "gog",
      objectId: "2143654691",
      label: "Heroes of Hammerwatch",
      path: "Heroes of Hammerwatch",
      data: false,
    },
    {
      shop: "steam",
      objectId: "1911610",
      label: "Windblown",
      path: "Motion Twin\\Windblown\\Steam_*",
      data: false,
    },
    {
      shop: "steam",
      objectId: "3405690",
      label: "EA Sports FC 26",
      error: true,
    },
    {
      shop: "steam",
      objectId: "4025700",
      label: "Heartopia",
      error: true,
    },
  ];

  const emulatorTargets = [
    { title: "Ocarina of Time 3D", path: "00040000\\00033600", data: true },
    { title: "Phantom Hourglass", path: ".nds.sram", data: true },
    { title: "Spirit Tracks", path: ".nds.sram", data: true },
    { title: "Bowser's Inside Story", error: true },
    { title: "Partners in Time", error: true },
    { title: "Pokemon - Red Version", path: ".gb.sram", data: true },
    { title: "Oracle of Ages", path: ".gbc.sram", data: true },
    { title: "Minish Cap", path: ".gba.sram", data: true },
    { title: "Majora's Mask", path: ".z64.sram", data: true },
    { title: "Hyrule Warriors", path: "01002B00111A2000", data: true },
    { title: "Super Mario Odyssey", error: true },
    { title: "Echoes of Wisdom", error: true },
    { title: "Breath of the Wild", path: "00050000\\101c9500", data: true },
    {
      title: "Twilight Princess HD",
      path: "00050000\\1019e600",
      data: false,
    },
  ];

  const inspect = async (game, expected) => {
    const details = await evaluateMain(
      ({ objectId, shop }) =>
        window.electron.getCloudSaveV2FileDetails(objectId, shop),
      game
    );
    const mappedFiles = details?.local?.files ?? [];
    const mappedPaths = mappedFiles.map((entry) => entry.absolutePath);
    const warningCodes = Array.from(
      new Set(
        (details?.variants ?? []).flatMap(
          (variant) => variant.warningCodes ?? []
        )
      )
    );
    const error =
      mappedFiles.length === 0 && warningCodes.length > 0
        ? warningCodes.join(", ")
        : null;
    const summary = {
      title: game.title,
      shop: game.shop,
      objectId: game.objectId,
      state: details?.state ?? null,
      error,
      paths: mappedPaths,
      files: mappedFiles.length,
      bytes: details?.local?.totalSizeBytes ?? 0,
    };
    results.push(summary);
    console.log(
      `${summary.error ? "SAFE-NO-DATA" : "MAPPED"} ${game.title}: ${mappedPaths.join(" | ") || summary.error || "manifest"}`
    );

    if (expected.error) {
      if (!summary.error)
        fail(`${game.title}: expected a safe unresolved state`);
      return;
    }
    if (summary.error) {
      fail(`${game.title}: unexpected mapping error: ${summary.error}`);
      return;
    }
    if (
      expected.path &&
      !mappedPaths.some((entry) =>
        normalize(entry).includes(normalize(expected.path))
      )
    ) {
      fail(`${game.title}: expected mapped path containing ${expected.path}`);
    }
    if (expected.data && mappedFiles.length === 0) {
      fail(`${game.title}: real save data was not detected by V2 mapping`);
    }
  };

  for (const target of pcTargets) {
    const game = active.find(
      (entry) =>
        entry.shop === target.shop && entry.objectId === target.objectId
    );
    if (!game) {
      fail(`${target.label}: registered game not found`);
      continue;
    }
    await inspect(game, target);
  }

  const launchboxGames = active.filter((game) => game.shop === "launchbox");
  for (const target of emulatorTargets) {
    const wanted = normalize(target.title);
    const game = launchboxGames.find((entry) =>
      normalize(entry.title).includes(wanted)
    );
    if (!game) {
      fail(`${target.title}: active emulator game not found`);
      continue;
    }
    await inspect(game, target);
  }

  const unsafeRoots = results
    .filter((entry) => entry.shop === "launchbox")
    .flatMap((entry) => entry.paths.map((savePath) => ({ entry, savePath })))
    .filter(({ savePath }) =>
      [
        /[\\/]ralibretro[\\/]Saves[\\/]*$/i,
        /[\\/]eden[\\/]user[\\/]nand[\\/]user[\\/]save[\\/]*$/i,
        /[\\/]user[\\/](?:sdmc|nand)[\\/]*$/i,
      ].some((pattern) => pattern.test(savePath))
    );
  for (const { entry, savePath } of unsafeRoots) {
    fail(`${entry.title}: mapper selected shared root ${savePath}`);
  }

  const wrongCanonical = /Ship of Harkinian|Holy Warrior|sm64ex/i;
  for (const result of results) {
    if (wrongCanonical.test(JSON.stringify(result))) {
      fail(`${result.title}: inherited a false PC mapping`);
    }
  }

  const report = {
    tested: results.length,
    registeredPc: pcTargets.length,
    activeEmulated: emulatorTargets.length,
    failures,
    results,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} finally {
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  try {
    const child = app.process();
    if (child.exitCode === null) child.kill();
  } catch {
    // The process handle is unavailable after a clean Playwright shutdown.
  }
  try {
    fs.rmSync(portableRoot, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove test clone ${portableRoot}: ${error}`);
  }
}

process.exit(failures.length ? 1 : 0);
