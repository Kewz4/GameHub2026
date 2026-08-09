/* global globalThis */

/**
 * Read-only acceptance audit for the signed-in, populated GameHub profile.
 *
 * The source LevelDB is copied into a temporary portable profile before the
 * development Electron build is launched. Only GETs and catalogue-search
 * POSTs are allowed; no library, achievement, profile, or R2 write is made.
 * The emitted JSON deliberately excludes auth/session values and API URLs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightPackage) {
  throw new Error("Set PLAYWRIGHT_PACKAGE to Playwright's package directory.");
}

const sourceData = process.env.GAMEHUB_LIVE_DATA?.trim();
if (!sourceData) {
  throw new Error(
    "Set GAMEHUB_LIVE_DATA to the populated GameHub data folder."
  );
}
const installedAsar = path.join(
  path.dirname(sourceData),
  "resources",
  "app.asar"
);
if (!fs.existsSync(installedAsar)) {
  throw new Error(`Installed app.asar is missing: ${installedAsar}`);
}

const { extractFile } = await import("@electron/asar");
const installedMain = extractFile(
  installedAsar,
  "out\\main\\index.js"
).toString("utf8");

const findInstalledHttpsUrl = (marker, predicate, radius = 8_000) => {
  const markerIndex = installedMain.indexOf(marker);
  const source = installedMain.slice(
    Math.max(0, markerIndex - radius),
    markerIndex + radius
  );
  return [...source.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
    .map((match) => match[0])
    .find((candidate) => {
      try {
        return predicate(new URL(candidate));
      } catch {
        return false;
      }
    });
};

const hydraApiUrl =
  process.env.GAMEHUB_API_URL?.trim() ??
  findInstalledHttpsUrl(
    "/auth/refresh",
    (url) =>
      !url.hostname.endsWith(".workers.dev") &&
      !url.hostname.endsWith(".cloudflarestorage.com")
  );
if (!hydraApiUrl) {
  throw new Error("Could not discover the installed Hydra API endpoint.");
}

const { _electron: electron } = await import(
  pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
);
const electronExecutable = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  "electron.exe"
);
const mainEntry = path.join(root, "out", "main", "index.js");

const isolatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-maintenance-audit-")
);
const isolatedData = path.join(isolatedRoot, "data");
await fs.promises.mkdir(isolatedData, { recursive: true });
await fs.promises.cp(
  path.join(sourceData, "gamehub-db"),
  path.join(isolatedData, "gamehub-db"),
  { recursive: true }
);

const app = await electron.launch({
  executablePath: electronExecutable,
  args: [mainEntry, "--no-sandbox", "--force-device-scale-factor=1"],
  cwd: root,
  timeout: 60_000,
  env: {
    ...process.env,
    APPDATA: isolatedRoot,
    LOCALAPPDATA: isolatedRoot,
    PORTABLE_EXECUTABLE_DIR: isolatedRoot,
    GAMEHUB_API_URL: hydraApiUrl,
    GAMEHUB_READ_ONLY_VISUAL_QA: "true",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

const findMainWindow = async () => {
  await app.firstWindow({ timeout: 40_000 });
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const mainWindow = app.windows().find((candidate) => {
      const url = candidate.url();
      return (
        url.includes("out/renderer/index.html") &&
        !url.includes("update-checker") &&
        !url.includes("achievement-notification")
      );
    });
    if (mainWindow) return mainWindow;

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
  throw new Error("GameHub main window did not open for the live audit.");
};

const normalize = (title) =>
  title
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(
      /\s*[-:]?\s*(game of the year|goty|definitive|complete|deluxe|ultimate|enhanced|remastered|standard)\s*(edition)?\s*$/i,
      ""
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const currentCatalogueMatch = (title, edges) => {
  const target = normalize(title);
  const exact = edges.find((edge) => normalize(edge.title) === target);
  if (exact) return exact;

  const partial = edges.find((edge) => {
    const candidate = normalize(edge.title);
    const longer = Math.max(candidate.length, target.length);
    const shorter = Math.min(candidate.length, target.length);
    return (
      longer > 0 &&
      shorter / longer >= 0.85 &&
      (candidate.includes(target) || target.includes(candidate))
    );
  });
  if (partial) return partial;

  const sequelNumerals = new Set([
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "ii",
    "iii",
    "iv",
    "vi",
    "vii",
    "viii",
    "ix",
    "xi",
    "xii",
  ]);
  if (target.length < 5) return null;
  return (
    edges.find((edge) => {
      const candidate = normalize(edge.title);
      if (!candidate.startsWith(`${target} `)) return false;
      return !sequelNumerals.has(
        candidate.slice(target.length + 1).split(" ")[0]
      );
    }) ?? null
  );
};

const cataloguePayload = (title, take) => ({
  title,
  sortBy: "popularity",
  sortOrder: "desc",
  downloadSourceFingerprints: [],
  tags: [],
  publishers: [],
  genres: [],
  developers: [],
  protondbSupportBadges: [],
  deckCompatibility: [],
  take,
  skip: 0,
});

const probeHttpAsset = async (url) => {
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if ([403, 405, 501].includes(response.status)) {
      response = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
    }
    return {
      ok: response.ok || response.status === 206,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Error ? error.name : "network-error",
    };
  }
};

try {
  const window = await findMainWindow();
  const outputDirectory = path.join(root, "artifacts", "maintenance-audit");
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  await window.waitForFunction(
    () => (document.getElementById("root")?.innerText.length ?? 0) > 10,
    undefined,
    { timeout: 30_000 }
  );

  const account = await window.evaluate(async () => {
    const user = await globalThis.window.electron.getMe();
    return user ? { displayName: user.displayName } : null;
  });
  if (!account) throw new Error("The cloned profile is not signed in.");

  const local = await app.evaluate(async () => {
    const sublevels = globalThis.__levelSublevels;
    const games = (await sublevels.gamesSublevel.values().all()).filter(
      (game) => !game.isDeleted
    );
    const result = [];
    for (const game of games) {
      const key = `${game.shop}:${game.objectId}`;
      const assets = await sublevels.gamesShopAssetsSublevel
        .get(key)
        .catch(() => null);
      result.push({
        key,
        title: game.title,
        shop: game.shop,
        objectId: game.objectId,
        libraryOrigin: game.libraryOrigin ?? null,
        playTimeInMilliseconds: game.playTimeInMilliseconds ?? 0,
        remoteId: game.remoteId ?? null,
        artwork: {
          cover: assets?.coverImageUrl ?? null,
          library: assets?.libraryImageUrl ?? null,
          hero: assets?.libraryHeroImageUrl ?? null,
          icon: assets?.iconUrl ?? game.iconUrl ?? null,
        },
      });
    }
    return result;
  });

  const cloud = await window.evaluate(() =>
    globalThis.window.electron.hydraApi.get("/profile/games")
  );
  const cloudDebuggerDryRun = await window.evaluate(() =>
    globalThis.window.electron.runCloudDebugger({ repair: false })
  );
  if (cloudDebuggerDryRun.mode !== "audit") {
    throw new Error("Cloud debugger did not honor read-only audit mode.");
  }
  const cloudKeys = new Set(
    cloud.map((game) => `${game.shop}:${game.objectId}`)
  );
  const missingFromCloud = local.filter(
    (game) => game.shop !== "custom" && !cloudKeys.has(game.key)
  );

  let searchIndex = 0;
  const searches = [];
  const searchWorkers = Array.from({ length: 4 }, async () => {
    while (searchIndex < missingFromCloud.length) {
      const game = missingFromCloud[searchIndex++];
      if (game.shop === "steam") continue;
      const wide = await window
        .evaluate(
          ({ payload }) =>
            globalThis.window.electron.hydraApi.post("/catalogue/search", {
              data: payload,
              needsAuth: false,
            }),
          { payload: cataloguePayload(game.title, 50) }
        )
        .catch((error) => ({ edges: [], error: String(error) }));
      const edges = wide?.edges ?? [];
      const topFiveMatch = currentCatalogueMatch(game.title, edges.slice(0, 5));
      const wideMatch = currentCatalogueMatch(game.title, edges);
      const narrow = [
        "Football Manager 2021 Touch",
        "League of Legends",
      ].includes(game.title)
        ? await window
            .evaluate(
              ({ payload }) =>
                globalThis.window.electron.hydraApi.post("/catalogue/search", {
                  data: payload,
                  needsAuth: false,
                }),
              { payload: cataloguePayload(game.title, 25) }
            )
            .catch((error) => ({ edges: [], error: String(error) }))
        : null;
      const narrowEdges = narrow?.edges ?? [];
      const narrowMatch = currentCatalogueMatch(game.title, narrowEdges);
      searches.push({
        key: game.key,
        title: game.title,
        resultCount: wide?.count ?? edges.length,
        topFiveMatch: topFiveMatch
          ? `${topFiveMatch.shop}:${topFiveMatch.objectId}:${topFiveMatch.title}`
          : null,
        wideMatch: wideMatch
          ? `${wideMatch.shop}:${wideMatch.objectId}:${wideMatch.title}`
          : null,
        wideMatchIndex: wideMatch ? edges.indexOf(wideMatch) : null,
        narrowMatch: narrowMatch
          ? `${narrowMatch.shop}:${narrowMatch.objectId}:${narrowMatch.title}`
          : null,
        narrowMatchIndex: narrowMatch ? narrowEdges.indexOf(narrowMatch) : null,
        narrowError: narrow?.error ?? null,
        firstResults: edges.slice(0, 8).map((edge) => ({
          shop: edge.shop,
          objectId: edge.objectId,
          title: edge.title,
        })),
        error: wide?.error ?? null,
      });
    }
  });
  await Promise.all(searchWorkers);

  let artworkIndex = 0;
  const brokenArtwork = [];
  const artworkWorkers = Array.from({ length: 12 }, async () => {
    while (artworkIndex < local.length) {
      const game = local[artworkIndex++];
      const url =
        game.artwork.cover ??
        game.artwork.library ??
        game.artwork.hero ??
        game.artwork.icon;
      if (!url) {
        brokenArtwork.push({
          key: game.key,
          title: game.title,
          status: "missing",
        });
        continue;
      }
      if (!/^https?:\/\//i.test(url)) continue;
      try {
        let response = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(8_000),
        });
        if (response.status === 405 || response.status === 501) {
          response = await fetch(url, {
            headers: { Range: "bytes=0-0" },
            redirect: "follow",
            signal: AbortSignal.timeout(8_000),
          });
        }
        if (!response.ok) {
          brokenArtwork.push({
            key: game.key,
            title: game.title,
            status: response.status,
            url,
          });
        }
      } catch (error) {
        brokenArtwork.push({
          key: game.key,
          title: game.title,
          status: error instanceof Error ? error.name : "network-error",
          url,
        });
      }
    }
  });
  await Promise.all(artworkWorkers);

  const catalogueDecisionLogs = await window.evaluate(async () => {
    const snapshot = await globalThis.window.electron.getConsoleLogSnapshot();
    return snapshot.entries
      .filter(
        (entry) =>
          entry.scope === "achievements" &&
          (entry.text.includes("Football Manager 2021 Touch") ||
            entry.text.includes("League of Legends"))
      )
      .map((entry) => ({
        level: entry.level,
        scope: entry.scope,
        text: entry.text,
      }));
  });

  const byNormalizedTitle = new Map();
  for (const game of local) {
    const key = normalize(game.title);
    byNormalizedTitle.set(key, [
      ...(byNormalizedTitle.get(key) ?? []),
      game.key,
    ]);
  }
  const duplicateGroups = [...byNormalizedTitle.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([title, keys]) => ({ title, keys }));

  // Repair and verify only the cloned profile. The source profile remains
  // untouched, while this exercises the exact IPC and LevelDB paths used by
  // the live app rather than a mocked metadata helper.
  await window.evaluate(() => {
    globalThis.location.hash = "#/library";
  });
  const arkCard = window.locator('button[title="ARK: Survival Evolved"]');
  await arkCard.waitFor({ state: "visible", timeout: 30_000 });
  const artworkRepair = await window.evaluate(() =>
    globalThis.window.electron.generateMissingMetadata()
  );
  const repairedArtwork = await app.evaluate(async () => {
    const targets = ["steam:346110", "steam:670290"];
    const values = [];
    for (const key of targets) {
      const assets = await globalThis.__levelSublevels.gamesShopAssetsSublevel
        .get(key)
        .catch(() => null);
      values.push({
        key,
        title: assets?.title ?? null,
        cover: assets?.coverImageUrl ?? null,
      });
    }
    return values;
  });
  const repairedArtworkChecks = [];
  for (const item of repairedArtwork) {
    const probe = item.cover
      ? await probeHttpAsset(item.cover)
      : { ok: false, status: "missing" };
    repairedArtworkChecks.push({ ...item, ...probe });
  }
  if (repairedArtworkChecks.some((item) => !item.ok)) {
    throw new Error(
      `Artwork health repair left a broken target: ${repairedArtworkChecks
        .filter((item) => !item.ok)
        .map((item) => item.key)
        .join(", ")}`
    );
  }

  // The repair emits a library refresh. Assert the already-open card adopts
  // the new cover without a route change/reload, then verify it decodes.
  const repairedArkCover = repairedArtworkChecks.find(
    (item) => item.key === "steam:346110"
  )?.cover;
  if (!repairedArkCover) throw new Error("ARK repair did not return a cover.");
  await window.waitForFunction(
    (expectedCover) => {
      const image = document.querySelector(
        'button[title="ARK: Survival Evolved"] img'
      );
      return image instanceof HTMLImageElement && image.src === expectedCover;
    },
    repairedArkCover,
    { timeout: 30_000 }
  );
  const arkImage = arkCard.locator("img");
  await arkImage.waitFor({ state: "visible", timeout: 15_000 });
  await arkImage.evaluate(
    (image) =>
      new Promise((resolve, reject) => {
        if (image.complete) {
          if (image.naturalWidth > 0) resolve(undefined);
          else reject(new Error("ARK artwork decoded with zero width"));
          return;
        }
        image.addEventListener("load", () => resolve(undefined), {
          once: true,
        });
        image.addEventListener(
          "error",
          () => reject(new Error("ARK artwork failed to load")),
          { once: true }
        );
      })
  );
  await arkCard.screenshot({
    path: path.join(outputDirectory, "ark-artwork-live-after-repair.png"),
  });

  // Generate multiple real renderer log levels before opening the console.
  // Their presence after Shift+S proves the always-on history works.
  await window.bringToFront();
  await window.evaluate(() => {
    console.info("[artwork] Visual QA retained ARK artwork repair");
    console.warn("[DownloadManager] Visual QA retained range warning");
    console.error("[PresentMon] Visual QA retained capture error");
    console.debug("[CloudSaveV2] Visual QA retained cloud trace");
  });
  await window.keyboard.press("Shift+S");

  let consoleWindow = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    consoleWindow = app
      .windows()
      .find((candidate) => /#\/?console(?:\?|$)/.test(candidate.url()));
    if (consoleWindow) break;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  if (!consoleWindow) {
    throw new Error("Shift+S did not open the diagnostics console.");
  }

  await consoleWindow.waitForSelector(".console", { timeout: 20_000 });
  await consoleWindow.waitForFunction(
    () =>
      document.body.innerText.includes(
        "Visual QA retained ARK artwork repair"
      ) &&
      document.body.innerText.includes("Visual QA retained range warning") &&
      document.body.innerText.includes("Visual QA retained capture error"),
    undefined,
    { timeout: 20_000 }
  );

  await consoleWindow.setViewportSize({ width: 1200, height: 720 });
  await consoleWindow.screenshot({
    path: path.join(outputDirectory, "diagnostics-console-live.png"),
  });
  const normalOverflow = await consoleWindow.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  if (normalOverflow > 1) {
    throw new Error(
      `Diagnostics console overflows horizontally by ${normalOverflow}px.`
    );
  }

  const pauseButton = consoleWindow.getByRole("button", { name: "Pause" });
  await pauseButton.click();
  await window.evaluate(() => {
    console.warn("[artwork] Visual QA buffered while paused");
  });
  await consoleWindow.waitForFunction(
    () => document.body.innerText.includes("buffered"),
    undefined,
    { timeout: 10_000 }
  );
  await consoleWindow.getByRole("button", { name: "Resume" }).click();
  await consoleWindow
    .getByLabel("Search diagnostics")
    .fill("buffered while paused");
  await consoleWindow.waitForFunction(
    () => document.body.innerText.includes("Visual QA buffered while paused"),
    undefined,
    { timeout: 10_000 }
  );
  await consoleWindow.getByLabel("Search diagnostics").fill("");

  await consoleWindow.setViewportSize({ width: 540, height: 560 });
  await consoleWindow.screenshot({
    path: path.join(outputDirectory, "diagnostics-console-compact-live.png"),
  });
  const compactOverflow = await consoleWindow.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  if (compactOverflow > 1) {
    throw new Error(
      `Compact diagnostics console overflows horizontally by ${compactOverflow}px.`
    );
  }

  const consoleEvidence = await consoleWindow.evaluate(() => ({
    title: document.querySelector("h1")?.textContent ?? null,
    entries:
      document.querySelector(".console__stats span")?.textContent ?? null,
    categories: [...document.querySelectorAll(".console__tabs button")].map(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() ?? ""
    ),
    openedByShiftS: true,
    retainedBeforeOpen: true,
    pauseResumeVerified: true,
    searchVerified: true,
  }));
  consoleEvidence.normalOverflow = normalOverflow;
  consoleEvidence.compactOverflow = compactOverflow;

  const report = {
    account: account.displayName,
    checkedAt: new Date().toISOString(),
    localCount: local.length,
    cloudCount: cloud.length,
    missingFromCloud: missingFromCloud.map((game) => ({
      key: game.key,
      title: game.title,
      origin: game.libraryOrigin,
      playtimeMinutes: Math.round(game.playTimeInMilliseconds / 60_000),
      hasRemoteId: Boolean(game.remoteId),
    })),
    catalogueSearches: searches.sort((a, b) => a.title.localeCompare(b.title)),
    catalogueDecisionLogs,
    brokenArtwork: brokenArtwork.sort((a, b) => a.title.localeCompare(b.title)),
    artworkRepair: {
      updated: artworkRepair.updated,
      skipped: artworkRepair.skipped,
      failed: artworkRepair.failed,
      liveRefreshWithoutReload: true,
      targets: repairedArtworkChecks,
    },
    duplicateGroups,
    cloudDebuggerDryRun,
    diagnosticsConsole: consoleEvidence,
  };

  const output = path.join(outputDirectory, "live-readonly-report.json");
  await fs.promises.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Read-only live maintenance audit written to ${output}`);
  console.log(
    JSON.stringify(
      {
        account: report.account,
        localCount: report.localCount,
        cloudCount: report.cloudCount,
        missingFromCloud: report.missingFromCloud.length,
        catalogueMissesInTopFive: searches.filter((item) => !item.topFiveMatch)
          .length,
        matchesOnlyOutsideTopFive: searches.filter(
          (item) => !item.topFiveMatch && item.wideMatch
        ).length,
        brokenArtwork: report.brokenArtwork,
        artworkRepair: report.artworkRepair,
        duplicateGroups: report.duplicateGroups,
        diagnosticsConsole: report.diagnosticsConsole,
        cloudDebuggerDryRun: {
          error: cloudDebuggerDryRun.error ?? null,
          issues: cloudDebuggerDryRun.issues.length,
          fixedByExistingCanonicalLink: cloudDebuggerDryRun.fixedCount,
          repairableOrInformational: cloudDebuggerDryRun.unfixedCount,
          noCatalogueMatch: cloudDebuggerDryRun.issues
            .filter((issue) => issue.fixError === "No Steam match")
            .map(
              (issue) => `${issue.shop}:${issue.objectId}:${issue.gameTitle}`
            ),
        },
      },
      null,
      2
    )
  );
} finally {
  await app.close().catch(() => undefined);
  await fs.promises.rm(isolatedRoot, { recursive: true, force: true });
}
