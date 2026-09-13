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

const sourceData = process.env.GAMEHUB_LIVE_DATA?.trim();
if (!sourceData) {
  throw new Error(
    "Set GAMEHUB_LIVE_DATA to the populated GameHub data folder."
  );
}
const requiredSourceDirectories = [
  "gamehub-db",
  "r2-image-cache",
  "Assets",
  "ludusavi",
];
for (const directory of requiredSourceDirectories) {
  const source = path.join(sourceData, directory);
  if (!fs.existsSync(source)) {
    throw new Error(`The live GameHub data directory is missing ${source}`);
  }
}

// Reuse the broker URL already baked into the user's installed GameHub build.
// It is configuration (not an R2 secret), stays in memory, and is never logged.
let r2CredentialsUrl = process.env.GAMEHUB_R2_CREDENTIALS_URL?.trim();
if (!r2CredentialsUrl) {
  const installedAsar = path.join(
    path.dirname(sourceData),
    "resources",
    "app.asar"
  );
  if (fs.existsSync(installedAsar)) {
    const { extractFile } = await import("@electron/asar");
    const installedMain = extractFile(
      installedAsar,
      "out\\main\\index.js"
    ).toString("utf8");
    const marker = installedMain.indexOf(
      "r2_credentials_broker_not_configured"
    );
    const nearbySource = installedMain.slice(
      Math.max(0, marker - 12_000),
      marker + 1_000
    );
    r2CredentialsUrl = [...nearbySource.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
      .map((match) => match[0])
      .find((candidate) => {
        try {
          const parsed = new URL(candidate);
          return (
            parsed.protocol === "https:" &&
            parsed.hostname.endsWith(".workers.dev")
          );
        } catch {
          return false;
        }
      });
  }
}
if (!r2CredentialsUrl) {
  throw new Error(
    "The installed GameHub build does not contain an R2 credential broker URL."
  );
}

let hydraApiUrl = process.env.GAMEHUB_API_URL?.trim();
if (!hydraApiUrl) {
  const installedAsar = path.join(
    path.dirname(sourceData),
    "resources",
    "app.asar"
  );
  const { extractFile } = await import("@electron/asar");
  const installedMain = extractFile(
    installedAsar,
    "out\\main\\index.js"
  ).toString("utf8");
  const marker = installedMain.indexOf("/auth/refresh");
  const nearbySource = installedMain.slice(
    Math.max(0, marker - 4_000),
    marker + 4_000
  );
  hydraApiUrl = [...nearbySource.matchAll(/https:\/\/[^\s"'`\\)]+/g)]
    .map((match) => match[0])
    .find((candidate) => {
      try {
        const parsed = new URL(candidate);
        return (
          parsed.protocol === "https:" &&
          !parsed.hostname.endsWith(".workers.dev") &&
          !parsed.hostname.endsWith(".cloudflarestorage.com")
        );
      } catch {
        return false;
      }
    });
}
if (!hydraApiUrl) {
  throw new Error(
    "The installed GameHub build does not contain its account API URL."
  );
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
const outputDirectory = path.join(repositoryRoot, "artifacts", "ui-qa-live");
const isolatedPortableRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gamehub-live-visual-clone-")
);
const isolatedData = path.join(isolatedPortableRoot, "data");

for (const required of [electronExecutable, mainEntry]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}

// electron-vite's production preview reports out/main as app.getAppPath(),
// while the native build lives at the repository root. Mirror the current
// development binaries beside the built main entry so validation uses the
// same native snapshot hasher as the packaged application.
await fs.promises.cp(
  path.join(repositoryRoot, "hydra-native"),
  path.join(path.dirname(mainEntry), "hydra-native"),
  { recursive: true }
);
await fs.promises.mkdir(isolatedData, { recursive: true });
await fs.promises.mkdir(path.join(isolatedData, "session"), {
  recursive: true,
});
await fs.promises.mkdir(outputDirectory, { recursive: true });

// Copy only the state needed to render the signed-in account and run the real
// save-rule detector. Downloads, emulator data, saves, and the 3+ GB Chromium
// session cache are deliberately excluded. Every local write made by this
// launch therefore lands in the clone.
for (const directory of requiredSourceDirectories) {
  await fs.promises.cp(
    path.join(sourceData, directory),
    path.join(isolatedData, directory),
    { recursive: true }
  );
}

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
    APPDATA: isolatedPortableRoot,
    LOCALAPPDATA: isolatedPortableRoot,
    PORTABLE_EXECUTABLE_DIR: isolatedPortableRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    GAMEHUB_READ_ONLY_VISUAL_QA: "true",
    GAMEHUB_R2_CREDENTIALS_URL: r2CredentialsUrl,
    GAMEHUB_API_URL: hydraApiUrl,
  },
});
const launchedProcess = electronApp.process();
const launchedStderr = [];
launchedProcess.stderr?.on("data", (chunk) => {
  launchedStderr.push(
    String(chunk)
      .replace(/https:\/\/[^\s"']+/g, "[redacted-url]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
  );
});

const pageErrors = [];

const findMainWindow = async () => {
  await electronApp.firstWindow({ timeout: 40_000 });
  let updateCheckerProceeded = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const mainWindow = electronApp.windows().find((candidate) => {
      try {
        const candidateUrl = new URL(candidate.url());
        return (
          candidateUrl.pathname.endsWith("/out/renderer/index.html") &&
          !candidateUrl.hash.includes("update-checker") &&
          !candidateUrl.hash.includes("achievement-notification") &&
          !candidateUrl.hash.includes("overlay")
        );
      } catch {
        return false;
      }
    });
    if (mainWindow) return mainWindow;

    if (!updateCheckerProceeded && attempt > 8) {
      const checker = electronApp
        .windows()
        .find((candidate) => candidate.url().includes("update-checker"));
      if (checker) {
        updateCheckerProceeded = true;
        await checker
          .evaluate(() => globalThis.window.electron.updateCheckerProceed())
          .catch(() => undefined);
      }
    }
  }
  const urls = electronApp.windows().map((candidate) => {
    try {
      return candidate.url();
    } catch {
      return "unavailable";
    }
  });
  throw new Error(
    `The cloned-profile GameHub main window did not open. Windows: ${JSON.stringify(urls)}`
  );
};

try {
  let window;
  try {
    window = await findMainWindow();
  } catch (error) {
    console.error(
      `electron diagnostic: exitCode=${launchedProcess.exitCode ?? "running"}, signal=${launchedProcess.signalCode ?? "none"}`
    );
    if (launchedStderr.length > 0) {
      console.error(
        `electron stderr:\n${launchedStderr.join("").slice(-4_000)}`
      );
    }
    const startupLogs = [
      path.join(isolatedPortableRoot, "GameHub", "startup.log"),
      path.join(isolatedData, "GameHub", "startup.log"),
    ];
    for (const startupLog of startupLogs) {
      if (fs.existsSync(startupLog)) {
        console.error(
          `startup diagnostic (${path.basename(path.dirname(startupLog))}):\n${fs.readFileSync(startupLog, "utf8")}`
        );
      }
    }
    throw error;
  }
  window.on("pageerror", (error) => pageErrors.push(String(error)));
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForFunction(
    () => (document.getElementById("root")?.innerText.length ?? 0) > 10,
    undefined,
    { timeout: 30_000 }
  );

  const capture = async (fileName, rootSelector) => {
    const root = window.locator(rootSelector).first();
    await root.waitFor({ state: "visible", timeout: 30_000 });
    const viewport = window.viewportSize();
    if (viewport) {
      await window.mouse.move(viewport.width - 2, viewport.height - 2);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const horizontalOverflow = await root.evaluate((element) => {
      const viewportWidth = globalThis.innerWidth;
      return Array.from(element.querySelectorAll("*"))
        .filter((child) => {
          const style = getComputedStyle(child);
          if (style.display === "none" || style.visibility === "hidden") {
            return false;
          }
          const rect = child.getBoundingClientRect();
          return (
            rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1)
          );
        })
        .map(
          (child) => `${child.tagName.toLowerCase()}.${String(child.className)}`
        )
        .slice(0, 10);
    });
    if (horizontalOverflow.length > 0) {
      throw new Error(
        `${rootSelector} has horizontally clipped descendants: ${horizontalOverflow.join(", ")}`
      );
    }
    const output = path.join(outputDirectory, fileName);
    await window.screenshot({ path: output });
    console.log(`captured ${output}`);
  };

  const ownAccount = await window.evaluate(async () => {
    const user = await globalThis.window.electron.getMe();
    return user?.id
      ? {
          id: user.id,
          displayName: user.displayName,
          profileImageUrl: user.profileImageUrl,
          backgroundImageUrl: user.backgroundImageUrl,
          profileVisibility: user.profileVisibility,
          bio: user.bio,
          karma: user.karma,
          backupsPerGameLimit: user.quirks?.backupsPerGameLimit ?? 10,
          hasActiveSubscription: Boolean(user.subscription),
        }
      : null;
  });
  if (!ownAccount) {
    throw new Error("The cloned GameHub profile is not signed in.");
  }

  const resolvedProfileImages = await window.evaluate(async (userId) => {
    const images = await globalThis.window.electron.getProfileImages(userId);
    return {
      hasAvatar: Boolean(images.profileImageUrl),
      hasBanner: Boolean(images.backgroundImageUrl),
      profileImageUrl: images.profileImageUrl,
      backgroundImageUrl: images.backgroundImageUrl,
    };
  }, ownAccount.id);

  // Optional, explicitly opted-in live verification. It selects a game whose
  // canonical LOCAL unlock-name set already equals Hydra Cloud, then PUTs the
  // exact remote rows back and proves the set is unchanged afterward. This
  // exercises the authenticated production endpoint without adding/removing an
  // achievement or creating a cloud-library game.
  if (process.env.GAMEHUB_VERIFY_IDEMPOTENT_ACHIEVEMENT_SYNC === "true") {
    const localAchievementSnapshot = await electronApp.evaluate(async () => {
      const sublevels = globalThis.__levelSublevels;
      const rows = await sublevels.gameAchievementsSublevel.iterator().all();
      return rows.map(([key, record]) => {
        const definitions = new Set(
          (record?.achievements ?? []).map((achievement) =>
            String(achievement.name ?? "").toUpperCase()
          )
        );
        const byName = new Map();
        for (const achievement of record?.unlockedAchievements ?? []) {
          const name = String(achievement.name ?? "").toUpperCase();
          if (!definitions.has(name)) continue;
          const previous = byName.get(name);
          if (
            !previous ||
            Number(achievement.unlockTime) < Number(previous.unlockTime)
          ) {
            byName.set(name, achievement);
          }
        }
        return { key, unlocked: [...byName.values()] };
      });
    });

    const liveAchievementSync = await window.evaluate(
      async (fixture) => {
        const { userId, localAchievementSnapshot } = fixture;
        const remoteGames =
          await globalThis.window.electron.hydraApi.get("/profile/games");
        const localByKey = new Map(
          localAchievementSnapshot.map((record) => [
            record.key,
            record.unlocked,
          ])
        );

        for (const remoteGame of remoteGames) {
          const key = `${remoteGame.shop}:${remoteGame.objectId}`;
          const localUnlocked = localByKey.get(key) ?? [];
          if (localUnlocked.length === 0) continue;

          const beforeRows = await globalThis.window.electron.hydraApi.get(
            `/users/${userId}/games/achievements`,
            {
              params: {
                shop: remoteGame.shop,
                objectId: remoteGame.objectId,
                language: "en",
              },
            }
          );
          const localNames = localUnlocked
            .map((achievement) => achievement.name.toUpperCase())
            .toSorted();
          const hydraRows = beforeRows.filter(
            (achievement) => achievement.unlockedOn?.hydra !== false
          );
          const remoteNames = hydraRows
            .map((achievement) => achievement.name.toUpperCase())
            .toSorted();
          if (
            remoteNames.length === 0 ||
            JSON.stringify(localNames) !== JSON.stringify(remoteNames)
          ) {
            continue;
          }

          const payload = hydraRows.map((achievement) => ({
            name: achievement.name,
            unlockTime:
              achievement.unlockTime ??
              localUnlocked.find(
                (local) =>
                  local.name.toUpperCase() === achievement.name.toUpperCase()
              )?.unlockTime ??
              Date.now(),
          }));
          await globalThis.window.electron.hydraApi.put(
            "/profile/games/achievements",
            { data: { id: remoteGame.id, achievements: payload } }
          );
          const afterRows = await globalThis.window.electron.hydraApi.get(
            `/users/${userId}/games/achievements`,
            {
              params: {
                shop: remoteGame.shop,
                objectId: remoteGame.objectId,
                language: "en",
              },
            }
          );
          const afterNames = afterRows
            .filter((achievement) => achievement.unlockedOn?.hydra !== false)
            .map((achievement) => achievement.name.toUpperCase())
            .toSorted();

          return {
            ok: JSON.stringify(remoteNames) === JSON.stringify(afterNames),
            shop: remoteGame.shop,
            objectId: remoteGame.objectId,
            title: remoteGame.title,
            unlocks: remoteNames.length,
          };
        }

        return { ok: false, reason: "no-identical-local-and-remote-game" };
      },
      { userId: ownAccount.id, localAchievementSnapshot }
    );

    if (!liveAchievementSync.ok) {
      throw new Error(
        `Idempotent achievement sync verification failed: ${JSON.stringify(liveAchievementSync)}`
      );
    }
    console.log(
      `idempotent achievement sync: ${JSON.stringify(liveAchievementSync)}`
    );
  }

  // The portable database and R2/local image lookup above are real. Keep the
  // renderer portion of this acceptance pass read-only and deterministic by
  // serving its own-profile GETs from the captured local account record. The
  // main process may use the persisted bearer for read-only R2 listing, but no
  // e-mail, password, or further write-capable API request leaves this clone.
  await electronApp.evaluate(
    ({ ipcMain }, fixture) => {
      ipcMain.removeHandler("hydraApiCall");
      ipcMain.handle("hydraApiCall", async (_event, request) => {
        if (request?.method !== "get") {
          throw new Error("read_only_visual_qa");
        }
        const url = String(request?.url ?? "");
        if (url === `/users/${fixture.profile.id}`) return fixture.profile;
        if (url === `/users/${fixture.profile.id}/stats`) {
          return {
            libraryCount: 0,
            friendsCount: 0,
            totalPlayTimeInSeconds: { value: 0, topPercentile: 0 },
            unlockedAchievementSum: 0,
          };
        }
        if (url.startsWith(`/users/${fixture.profile.id}/library`)) {
          return { library: [], pinnedGames: [], totalCount: 0 };
        }
        if (url === `/users/${fixture.profile.id}/reviews`) {
          return { reviews: [], totalCount: 0 };
        }
        if (url.endsWith("/how-long-to-beat")) return [];
        if (url.endsWith("/protondb")) return null;
        if (url.includes("/download-sources")) return [];
        if (url.startsWith("/badges?")) return [];
        return {};
      });
    },
    {
      profile: {
        id: ownAccount.id,
        displayName: ownAccount.displayName,
        profileImageUrl:
          resolvedProfileImages.profileImageUrl ?? ownAccount.profileImageUrl,
        email: null,
        backgroundImageUrl:
          resolvedProfileImages.backgroundImageUrl ??
          ownAccount.backgroundImageUrl,
        profileVisibility: ownAccount.profileVisibility,
        libraryGames: [],
        recentGames: [],
        friends: [],
        totalFriends: 0,
        relation: null,
        currentGame: null,
        bio: ownAccount.bio,
        hasActiveSubscription: ownAccount.hasActiveSubscription,
        karma: ownAccount.karma,
        quirks: { backupsPerGameLimit: ownAccount.backupsPerGameLimit },
        badges: [],
        hasCompletedWrapped2025: false,
      },
    }
  );

  globalThis.console.log("opening the cloned account profile");
  await window.evaluate((userId) => {
    globalThis.location.hash = `/profile/${encodeURIComponent(userId)}`;
  }, ownAccount.id);
  await window
    .locator(".profile__wrapper")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.waitForFunction(
    (expectedBanner) => {
      const image = document.querySelector(".profile-hero__background-image");
      if (!(image instanceof HTMLImageElement)) return false;
      const decoded = image.complete && image.naturalWidth > 0;
      if (!decoded) return false;
      return !expectedBanner || image.getAttribute("src") === expectedBanner;
    },
    resolvedProfileImages.backgroundImageUrl,
    { timeout: 30_000 }
  );
  await capture("profile-banner-live-account.png", ".profile__wrapper");

  await window.waitForFunction(
    () => document.querySelectorAll(".user-library-game__wrapper").length > 0,
    undefined,
    { timeout: 30_000 }
  );
  await window.waitForFunction(
    () =>
      Number(
        document
          .querySelector("[data-profile-total-playtime-seconds]")
          ?.getAttribute("data-profile-total-playtime-seconds") ?? 0
      ) > 0,
    undefined,
    { timeout: 30_000 }
  );

  const verifyProfileSort = async (buttonName, dataAttribute) => {
    const sortButton = window.getByRole("button", {
      name: buttonName,
      exact: true,
    });
    await sortButton.click();
    await window.waitForFunction(
      ({ buttonName }) =>
        Array.from(document.querySelectorAll(".sort-options__option")).some(
          (button) =>
            button.textContent?.trim() === buttonName &&
            button.getAttribute("aria-pressed") === "true"
        ),
      { buttonName },
      { timeout: 30_000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    const sections = await window.evaluate((attribute) => {
      return Array.from(
        document.querySelectorAll(".profile-content__games-grid")
      )
        .map((grid) =>
          Array.from(grid.querySelectorAll(".user-library-game__wrapper")).map(
            (card) => Number(card.getAttribute(attribute) ?? 0)
          )
        )
        .filter((values) => values.length > 1);
    }, dataAttribute);
    for (const values of sections) {
      if (
        values.some((value, index) => index > 0 && value > values[index - 1])
      ) {
        throw new Error(
          `${buttonName} did not sort every displayed profile section: ${values.slice(0, 20).join(", ")}`
        );
      }
    }
  };

  await verifyProfileSort(
    "Achievements earned",
    "data-profile-game-achievements"
  );
  await verifyProfileSort("Playtime", "data-profile-game-playtime");
  await verifyProfileSort("Played recently", "data-profile-game-last-played");

  const profileCardAudit = await window.evaluate(() => {
    const normalize = (value) =>
      value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
    const titles = Array.from(
      document.querySelectorAll(".user-library-game__wrapper")
    )
      .map((card) => card.getAttribute("data-profile-game-title") ?? "")
      .filter(Boolean);
    const identities = Array.from(
      document.querySelectorAll(".user-library-game__wrapper")
    )
      .map((card) => card.getAttribute("data-profile-game-key") ?? "")
      .filter(Boolean);
    const seen = new Set();
    const duplicates = [];
    for (const title of titles) {
      const key = normalize(title);
      if (seen.has(key)) duplicates.push(title);
      seen.add(key);
    }
    return {
      cardCount: titles.length,
      duplicates,
      duplicateIdentities: identities.length - new Set(identities).size,
      totalPlayTimeInSeconds: Number(
        document
          .querySelector("[data-profile-total-playtime-seconds]")
          ?.getAttribute("data-profile-total-playtime-seconds") ?? 0
      ),
    };
  });
  if (
    profileCardAudit.duplicates.length > 0 ||
    profileCardAudit.duplicateIdentities > 0 ||
    profileCardAudit.totalPlayTimeInSeconds <= 0
  ) {
    throw new Error(
      `The live profile audit failed: ${JSON.stringify(profileCardAudit)}`
    );
  }

  const achievementsTab = window
    .locator(".profile-content__tab")
    .filter({ hasText: /^achievements/i })
    .first();
  await achievementsTab.waitFor({ state: "visible", timeout: 20_000 });
  await achievementsTab.click();
  await window
    .locator(".profile-achievements")
    .waitFor({ state: "visible", timeout: 20_000 });
  await window.waitForFunction(
    () =>
      document.querySelectorAll(".profile-achievements__games > li").length > 0,
    undefined,
    { timeout: 60_000 }
  );

  const achievementGamesAudit = await window.evaluate(async () => {
    const games = await globalThis.window.electron.getAchievementGames();
    const identityKeys = games.map((game) => `${game.shop}:${game.objectId}`);
    const normalizedTitles = games.map((game) =>
      game.title.toLocaleLowerCase().replace(/[^a-z0-9]/g, "")
    );
    return {
      games: games.length,
      totalUnlocked: games.reduce(
        (sum, game) => sum + (game.unlockedAchievementCount ?? 0),
        0
      ),
      duplicateIdentities: identityKeys.length - new Set(identityKeys).size,
      duplicateTitles: normalizedTitles.length - new Set(normalizedTitles).size,
    };
  });
  if (
    achievementGamesAudit.duplicateIdentities > 0 ||
    achievementGamesAudit.duplicateTitles > 0
  ) {
    throw new Error(
      `Achievement profile dedupe failed: ${JSON.stringify(achievementGamesAudit)}`
    );
  }
  await capture("profile-achievements-live-account.png", ".profile__wrapper");

  const completedFilter = window.getByRole("button", {
    name: "Completed",
    exact: true,
  });
  await completedFilter.click();
  const completedPercentages = await window
    .locator(".profile-achievements__percentage")
    .allTextContents();
  if (completedPercentages.some((value) => value.trim() !== "100%")) {
    throw new Error(
      `Completed achievement filter leaked incomplete games: ${completedPercentages.join(", ")}`
    );
  }
  await capture(
    "profile-achievements-completed-filter-live-account.png",
    ".profile__wrapper"
  );

  await window.getByRole("button", { name: "All", exact: true }).click();
  await window.locator(".profile-achievements__sort").selectOption("name");
  const sortedAchievementTitles = await window
    .locator(".profile-achievements__game-copy strong")
    .allTextContents();
  const expectedAchievementTitles = [...sortedAchievementTitles].sort((a, b) =>
    a.localeCompare(b)
  );
  if (
    JSON.stringify(sortedAchievementTitles) !==
    JSON.stringify(expectedAchievementTitles)
  ) {
    throw new Error("The achievement Name sort did not apply to every card.");
  }

  const firstAchievementGame = window
    .locator(".profile-achievements__games > li button")
    .first();
  await firstAchievementGame.click();
  await window
    .locator(".profile-achievements__detail-header")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.waitForFunction(
    () =>
      document.querySelectorAll(".profile-achievements .achievements__item")
        .length > 0,
    undefined,
    { timeout: 60_000 }
  );
  await capture(
    "profile-achievements-game-live-account.png",
    ".profile__wrapper"
  );

  console.log(
    `profile audit: ${JSON.stringify({ ...profileCardAudit, ...achievementGamesAudit })}`
  );

  const cloudLibraryProbe = await window.evaluate(async () => {
    try {
      const entries = await globalThis.window.electron.getCloudSaveV2Library();
      return { ok: true, count: entries.length };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
  console.log(`cloud library probe: ${JSON.stringify(cloudLibraryProbe)}`);

  // Exercise the real desktop sidebar link instead of assigning the route.
  await window.evaluate(() => {
    globalThis.location.hash = "/";
  });
  const cloudSidebarLink = window
    .getByRole("button", { name: "Cloud Saves", exact: true })
    .or(window.getByRole("link", { name: "Cloud Saves", exact: true }))
    .first();
  await cloudSidebarLink.waitFor({ state: "visible", timeout: 20_000 });
  await cloudSidebarLink.click();
  await window
    .locator(".cloud-saves")
    .waitFor({ state: "visible", timeout: 20_000 });
  await window.waitForFunction(
    () =>
      !document.querySelector(".cloud-saves [role='status']") &&
      (document.querySelector(".cloud-saves__list") ||
        document.querySelector(".cloud-saves__load-error") ||
        document.querySelector(".cloud-saves__empty")),
    undefined,
    { timeout: 30_000 }
  );
  const cloudEntryCount = await window
    .locator(".cloud-saves__game-group")
    .count();
  if (cloudEntryCount === 0) {
    const diagnostic = await window
      .locator(".cloud-saves")
      .innerText()
      .catch(() => "unavailable");
    throw new Error(
      `The real Cloud Saves sidebar did not load a populated list: ${diagnostic.slice(0, 500)}`
    );
  }
  await capture("cloud-saves-sidebar-live-account.png", ".cloud-saves");

  await window.evaluate(() => {
    globalThis.location.hash = "/downloads";
  });
  await window
    .locator(".downloads__page")
    .waitFor({ state: "visible", timeout: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await capture("downloads-live-account.png", ".downloads__page");
  await window.locator("#downloads-manager-tab-downloads").focus();
  await window.keyboard.press("ArrowRight");
  await window
    .locator("#downloads-manager-panel-custom")
    .waitFor({ state: "visible", timeout: 10_000 });
  await capture(
    "download-manager-add-custom-live-account.png",
    ".downloads__page"
  );
  await window.locator(".downloads__custom-options button").first().click();
  await window
    .locator(".custom-download-modal")
    .waitFor({ state: "visible", timeout: 10_000 });
  const emptyCustomSubmit = window.locator(
    '.custom-download-modal button[type="submit"]'
  );
  if (!(await emptyCustomSubmit.isDisabled())) {
    throw new Error(
      "The empty custom-download form exposed an enabled submit action."
    );
  }
  await capture(
    "custom-download-modal-live-account.png",
    ".custom-download-modal"
  );
  await window.locator(".modal__close-button:visible").click();
  await window
    .locator(".custom-download-modal")
    .waitFor({ state: "hidden", timeout: 10_000 });

  await window.evaluate(() => {
    globalThis.location.hash = "/cloud-saves";
  });
  await window
    .locator(".cloud-saves__entry-actions button")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.locator(".cloud-saves__entry-actions button").first().click();
  await window
    .locator(".cloud-save-v2__modal")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window
    .locator(".cloud-save-v2__modal .cloud-save-v2__snapshot--skeleton")
    .waitFor({ state: "detached", timeout: 120_000 });
  await window.waitForFunction(
    () => {
      const root = document.querySelector(".cloud-save-v2__modal");
      if (!root) return false;
      const interactive = root.querySelector(
        ".cloud-save-v2__snapshot-stats--interactive"
      );
      return (
        (interactive instanceof HTMLButtonElement && !interactive.disabled) ||
        Boolean(root.querySelector(".cloud-save-v2__error")) ||
        root.textContent?.includes("Executable required")
      );
    },
    undefined,
    { timeout: 180_000 }
  );
  // The actionable overview can briefly render before automatic sync starts.
  // Let that hand-off occur, then require the final non-busy state so this
  // capture proves the settled manager rather than an analysis transition.
  await new Promise((resolve) => setTimeout(resolve, 750));
  await window.waitForFunction(
    () => {
      const root = document.querySelector(".cloud-save-v2__modal");
      if (!root) return false;
      const text = root.textContent ?? "";
      return (
        !root.querySelector(".button__loading-icon") &&
        !text.includes("Analyzing saves") &&
        !text.includes("Synchronizing")
      );
    },
    undefined,
    { timeout: 180_000 }
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await capture("cloud-save-manager-live-account.png", ".cloud-save-v2__modal");

  const managedGame = await window.evaluate(() => {
    const match = globalThis.location.hash.match(
      /^#\/game\/([^/]+)\/([^?]+)(?:\?(.*))?$/
    );
    if (!match) return null;
    const params = new URLSearchParams(match[3] ?? "");
    return {
      shop: decodeURIComponent(match[1]),
      objectId: decodeURIComponent(match[2]),
      title: params.get("title") ?? "Game",
    };
  });
  if (!managedGame) {
    throw new Error(
      "The real Cloud Saves Manage button opened an invalid route."
    );
  }
  await window.locator(".modal__close-button:visible").click();
  await window
    .locator(".cloud-save-v2__modal")
    .waitFor({ state: "hidden", timeout: 20_000 });

  const overviewProbe = await window.evaluate(async (game) => {
    try {
      const overview = await globalThis.window.electron.getCloudSaveOverview(
        game.objectId,
        game.shop
      );
      return {
        ok: true,
        state: overview.state,
        hasRemoteSnapshot: Boolean(overview.activeRemoteSnapshot),
        remoteFileCount: overview.activeRemoteSnapshot?.fileCount ?? 0,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, managedGame);
  console.log(`cloud overview probe: ${JSON.stringify(overviewProbe)}`);

  const gameRoute = `/game/${encodeURIComponent(managedGame.shop)}/${encodeURIComponent(managedGame.objectId)}?title=${encodeURIComponent(managedGame.title)}`;
  await window.evaluate((route) => {
    globalThis.location.hash = route;
  }, gameRoute);
  await window
    .locator(".game-details__container")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.evaluate((objectId) => {
    globalThis.dispatchEvent(
      new CustomEvent("hydra:openGameOptions", { detail: { objectId } })
    );
  }, managedGame.objectId);
  await window
    .locator(".game-options-modal__container")
    .waitFor({ state: "visible", timeout: 20_000 });
  await window
    .locator(".game-options-modal__sidebar-button", { hasText: "Cloud Saves" })
    .click();
  await window
    .locator(".game-options-modal__cloud-panel")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window
    .locator(
      ".game-options-modal__cloud-panel .cloud-save-v2__snapshot--skeleton"
    )
    .waitFor({ state: "detached", timeout: 120_000 });
  await window.waitForFunction(
    () => {
      const root = document.querySelector(".game-options-modal__cloud-panel");
      if (!root) return false;
      const interactive = root.querySelector(
        ".cloud-save-v2__snapshot-stats--interactive"
      );
      return (
        (interactive instanceof HTMLButtonElement && !interactive.disabled) ||
        Boolean(root.querySelector(".cloud-save-v2__error")) ||
        root.textContent?.includes("Executable required")
      );
    },
    undefined,
    { timeout: 180_000 }
  );
  await capture(
    "game-options-cloud-saves-live-account.png",
    ".game-options-modal__container"
  );
  const fileMapperEntry = window
    .locator(
      ".game-options-modal__cloud-panel .cloud-save-v2__snapshot-stats--interactive"
    )
    .first();
  await fileMapperEntry.waitFor({ state: "visible", timeout: 30_000 });
  await window.waitForFunction(
    () => {
      const button = document.querySelector(
        ".game-options-modal__cloud-panel .cloud-save-v2__snapshot-stats--interactive"
      );
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    undefined,
    { timeout: 30_000 }
  );
  await fileMapperEntry.click();
  await window
    .locator(".cloud-save-v2__file-browser-modal")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window
    .locator(".cloud-save-v2__file-browser-modal .cloud-save-v2__browser-state")
    .waitFor({ state: "detached", timeout: 180_000 });
  await capture(
    "game-options-save-file-mapper-live-account.png",
    ".cloud-save-v2__file-browser-modal"
  );

  const bigPictureRoute = `/big-picture/game/${encodeURIComponent(managedGame.shop)}/${encodeURIComponent(managedGame.objectId)}?title=${encodeURIComponent(managedGame.title)}`;
  await window.evaluate((route) => {
    globalThis.location.hash = route;
  }, bigPictureRoute);
  await window
    .locator(".game-page")
    .waitFor({ state: "visible", timeout: 40_000 });
  await window
    .locator("#game-hero-open-settings")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.locator("#game-hero-open-settings").click();
  await window
    .locator('[data-sidebar-modal][data-active-sidebar-tab="launch"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  await window.locator('[data-sidebar-tab-id="hydra_cloud"]').click();
  await window
    .locator('[data-sidebar-panel-id="hydra_cloud"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await window
    .locator('[data-sidebar-panel-id="hydra_cloud"] .button__loading-icon')
    .waitFor({ state: "detached", timeout: 180_000 });
  await capture(
    "game-settings-cloud-saves-big-picture-live-account.png",
    "[data-sidebar-modal]"
  );
  await window
    .locator('[data-sidebar-panel-id="hydra_cloud"] button', {
      hasText: "Open Cloud Saves",
    })
    .click();
  await window
    .locator(".big-picture-cloud-save-modal")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window
    .locator(
      ".big-picture-cloud-save-modal .big-picture-cloud-save__snapshot-placeholder"
    )
    .waitFor({ state: "detached", timeout: 180_000 });
  await capture(
    "cloud-save-manager-big-picture-live-account.png",
    ".big-picture-cloud-save-modal"
  );
  await window
    .locator(".big-picture-cloud-save-modal button", {
      hasText: /View conflicts|Manage save locations/,
    })
    .click();
  await window
    .locator(".big-picture-cloud-save-details-modal")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.waitForFunction(
    () => {
      const root = document.querySelector(
        ".big-picture-cloud-save-details-modal"
      );
      return Boolean(
        root?.querySelector(".big-picture-cloud-save-details__summary") ||
          root?.querySelector(".big-picture-cloud-save-details__error")
      );
    },
    undefined,
    { timeout: 180_000 }
  );
  await capture(
    "game-options-save-file-mapper-big-picture-live-account.png",
    ".big-picture-cloud-save-details-modal"
  );

  if (pageErrors.length > 0) {
    throw new Error(`Renderer page errors: ${pageErrors.join(" | ")}`);
  }

  console.log(
    `verified live clone: banner=${resolvedProfileImages.hasBanner ? "resolved-and-decoded" : "decoded-api-fallback"}, avatar=${resolvedProfileImages.hasAvatar ? "resolved" : "fallback"}, cloudGames=${cloudEntryCount}`
  );
} finally {
  await electronApp.close().catch(() => undefined);
  if (process.env.GAMEHUB_KEEP_VISUAL_CLONE === "true") {
    console.log(`kept visual clone at ${isolatedPortableRoot}`);
  } else {
    await fs.promises
      .rm(isolatedPortableRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
