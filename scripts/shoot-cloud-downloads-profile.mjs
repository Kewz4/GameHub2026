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
  path.join(os.tmpdir(), "gamehub-visual-qa-")
);

for (const required of [electronExecutable, mainEntry]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}
await fs.promises.mkdir(outputDirectory, { recursive: true });

const makeSvgDataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const iconDataUrl = makeSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="24" fill="#f4f4f4"/>
    <path d="M31 78c7-27 17-40 33-40s26 13 33 40" fill="none" stroke="#111" stroke-width="10" stroke-linecap="round"/>
    <circle cx="48" cy="68" r="6" fill="#111"/><circle cx="80" cy="68" r="6" fill="#111"/>
  </svg>
`);
const bannerDataUrl = makeSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520">
    <rect width="1600" height="520" fill="#080808"/>
    <circle cx="1260" cy="110" r="380" fill="#222"/>
    <circle cx="1320" cy="70" r="245" fill="#eee"/>
    <path d="M0 430 C330 270 650 610 980 390 C1220 230 1430 250 1600 330 V520 H0Z" fill="#151515"/>
  </svg>
`);
const fallbackBannerDataUrl = makeSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520">
    <rect width="1600" height="520" fill="#181818"/>
    <path d="M0 390 L360 170 L720 390 L1080 170 L1440 390 L1600 290 V520 H0Z" fill="#3b3b3b"/>
  </svg>
`);
const achievementIconDataUrl = makeSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="achievement" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#f5f5f5"/>
        <stop offset="1" stop-color="#8c8c8c"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="18" fill="#0a0a0a"/>
    <circle cx="64" cy="58" r="34" fill="none" stroke="url(#achievement)" stroke-width="8"/>
    <path d="M48 59l11 11 23-27" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M45 91h38" stroke="#8c8c8c" stroke-width="6" stroke-linecap="round"/>
  </svg>
`);
const souvenirScreenshotDataUrl = makeSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="chamber" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#050505"/>
        <stop offset="0.55" stop-color="#1a1a1a"/>
        <stop offset="1" stop-color="#080808"/>
      </linearGradient>
      <radialGradient id="portal" cx="50%" cy="50%" r="50%">
        <stop offset="0.7" stop-color="#050505"/>
        <stop offset="0.82" stop-color="#f8f8f8"/>
        <stop offset="1" stop-color="#777" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#chamber)"/>
    <path d="M0 630L510 390l410 172 680-300v638H0z" fill="#111" stroke="#333" stroke-width="4"/>
    <path d="M0 710l530-224 376 151 694-306" fill="none" stroke="#555" stroke-width="3" opacity=".55"/>
    <ellipse cx="1170" cy="430" rx="155" ry="245" fill="url(#portal)" opacity=".92"/>
    <ellipse cx="1170" cy="430" rx="105" ry="190" fill="#020202"/>
    <path d="M386 630l115-52 92 38-119 57z" fill="#f0f0f0" opacity=".9"/>
    <circle cx="505" cy="610" r="13" fill="#fff"/>
    <circle cx="548" cy="625" r="13" fill="#fff"/>
    <rect x="72" y="66" width="1456" height="768" rx="28" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>
  </svg>
`);

const GAMEPAD_BUTTON = Object.freeze({
  a: 0,
  b: 1,
  right: 15,
});

async function installMockXboxGamepad(page) {
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const gamepad = {
      axes: [0, 0, 0, 0],
      buttons,
      connected: true,
      id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
      index: 0,
      mapping: "standard",
      timestamp: globalThis.performance.now(),
      vibrationActuator: null,
      hapticActuators: [],
    };

    Object.defineProperty(globalThis.navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    globalThis.__GAMEHUB_QA_GAMEPAD = gamepad;

    const connectedEvent = new Event("gamepadconnected");
    Object.defineProperty(connectedEvent, "gamepad", {
      configurable: true,
      value: gamepad,
    });
    globalThis.dispatchEvent(connectedEvent);
  });
  await page.waitForTimeout(180);
}

async function pressGamepadButton(page, buttonIndex) {
  await page.evaluate((index) => {
    const gamepad = globalThis.__GAMEHUB_QA_GAMEPAD;
    if (!gamepad) throw new Error("The QA gamepad is not connected.");
    const button = gamepad.buttons[index];
    if (!button) throw new Error("The requested QA gamepad button is absent.");
    button.pressed = true;
    button.touched = true;
    button.value = 1;
    gamepad.timestamp = globalThis.performance.now();
  }, buttonIndex);
  await page.waitForTimeout(90);
  await page.evaluate((index) => {
    const gamepad = globalThis.__GAMEHUB_QA_GAMEPAD;
    const button = gamepad?.buttons[index];
    if (!button) return;
    button.pressed = false;
    button.touched = false;
    button.value = 0;
    gamepad.timestamp = globalThis.performance.now();
  }, buttonIndex);
  await page.waitForTimeout(260);
}

async function focusBigPictureItem(page, selector, expectedId) {
  const item = page.locator(selector).first();
  await item.waitFor({ state: "visible", timeout: 20_000 });
  await item.scrollIntoViewIfNeeded();
  await item.focus();
  await page.waitForTimeout(140);
  const focusedId = await page.evaluate(
    () => document.querySelector("[data-focus-visible='true']")?.id ?? null
  );
  if (focusedId !== expectedId) {
    throw new Error(
      `Controller focus expected ${expectedId}, received ${focusedId ?? "none"}.`
    );
  }
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
    APPDATA: isolatedProfile,
    LOCALAPPDATA: isolatedProfile,
    PORTABLE_EXECUTABLE_DIR: isolatedProfile,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

const rendererErrors = [];
const rendererConsoleErrors = [];

try {
  await electronApp.firstWindow({ timeout: 40_000 });

  let window = null;
  let updateCheckerProceeded = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    window = electronApp.windows().find((candidate) => {
      try {
        const candidateUrl = new URL(candidate.url());
        return (
          candidateUrl.pathname.endsWith("/out/renderer/index.html") &&
          !candidateUrl.hash.includes("update-checker") &&
          (candidateUrl.hash === "" || candidateUrl.hash.startsWith("#/"))
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
        try {
          await checker.evaluate(() =>
            globalThis.window.electron.updateCheckerProceed()
          );
          updateCheckerProceeded = true;
        } catch (error) {
          // The visual harness launches the unpackaged production bundle. If
          // preload/IPC startup is late, keep polling instead of permanently
          // marking the splash as handled and timing out with no screenshots.
          if (attempt > 32) {
            await electronApp.evaluate(({ BrowserWindow }) => {
              BrowserWindow.getAllWindows()
                .find((candidate) =>
                  candidate.webContents.getURL().includes("update-checker")
                )
                ?.close();
            });
            updateCheckerProceeded = true;
          } else {
            console.warn(
              `Update-checker proceed is not ready yet: ${String(error)}`
            );
          }
        }
      }
    }
  }
  if (!window) {
    const openWindowUrls = electronApp.windows().map((candidate) => {
      try {
        return candidate.url();
      } catch {
        return "unavailable";
      }
    });
    throw new Error(
      `The main GameHub window did not open. Windows: ${JSON.stringify(openWindowUrls)}`
    );
  }

  window.on("pageerror", (error) => rendererErrors.push(String(error)));
  window.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      rendererConsoleErrors.push(
        `${message.text()}${location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : ""}`
      );
    }
  });
  await window.setViewportSize({ width: 1440, height: 900 });

  await electronApp.evaluate(
    ({ ipcMain }, fixture) => {
      const replaceHandler = (channel, handler) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      };

      globalThis.__gameHubVisualQaCloudLibraryMode = "success";
      globalThis.__gameHubVisualQaOpenSaveFolderCalls = [];
      replaceHandler("getCloudSaveV2Library", async () => {
        const mode = globalThis.__gameHubVisualQaCloudLibraryMode;
        if (mode === "error") {
          throw new Error("visual-qa-cloud-library-error");
        }
        if (mode === "empty") return [];
        if (mode === "loading") {
          return new Promise(() => undefined);
        }
        return fixture.cloudSaves;
      });
      replaceHandler("getGameByObjectId", async (_event, shop, objectId) =>
        shop === fixture.game.shop && objectId === fixture.game.objectId
          ? fixture.game
          : null
      );
      replaceHandler("findLibraryGameByTitle", async () => null);
      replaceHandler("getGameShopDetails", async () => fixture.shopDetails);
      replaceHandler("getGameAssets", async () => fixture.shopDetails.assets);
      replaceHandler("getGameStats", async () => null);
      replaceHandler("getRandomGame", async () => null);
      replaceHandler("getLibrary", async () => fixture.profileGames);
      replaceHandler(
        "getAchievementGames",
        async () => fixture.achievementGames
      );
      replaceHandler("getAchievementSouvenirs", async (_event, ownerId) =>
        ownerId === fixture.profile.id ? fixture.achievementSouvenirs : []
      );
      replaceHandler("getUnlockedAchievements", async () => []);
      replaceHandler("getGameSaveFolder", async () => fixture.saveFolderPath);
      replaceHandler(
        "openGameSaveFolder",
        async (_event, shop, objectId, saveFolderPath) => {
          globalThis.__gameHubVisualQaOpenSaveFolderCalls.push({
            shop,
            objectId,
            saveFolderPath,
          });
          return true;
        }
      );
      replaceHandler("getAvailableDrives", async () => []);
      replaceHandler(
        "getCloudSaveOverview",
        async () => fixture.cloudSaveOverview
      );
      replaceHandler(
        "getCloudSaveV2FileDetails",
        async () => fixture.cloudSaveFileDetails
      );
      replaceHandler("getProfileImages", async (_event, userId) => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        return userId === fixture.profile.id
          ? fixture.r2ProfileImages
          : { profileImageUrl: null, backgroundImageUrl: null };
      });
      replaceHandler("getMe", async () => fixture.userDetails);
      replaceHandler("hydraApiCall", async (_event, payload) => {
        const url = String(payload?.url ?? "");
        if (url === `/users/${fixture.profile.id}`) return fixture.profile;
        if (url === `/users/${fixture.profile.id}/stats`) {
          return {
            libraryCount: fixture.profileGames.length,
            friendsCount: 4,
            totalPlayTimeInSeconds: {
              value: 346_320,
              topPercentile: 8,
            },
            achievementsPointsEarnedSum: {
              value: 580,
              topPercentile: 12,
            },
            unlockedAchievementSum: 58,
          };
        }
        if (url.startsWith(`/users/${fixture.profile.id}/library`)) {
          return {
            library: fixture.profileGames,
            pinnedGames: [],
            totalCount: fixture.profileGames.length,
          };
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
      cloudSaves: [
        {
          id: "active-hades-ii",
          version: 12,
          createdAt: "2026-08-08T13:45:00.000Z",
          updatedAt: "2026-08-08T15:08:00.000Z",
          fileCount: 18,
          totalSizeBytes: 12_884_901,
          aggregateHash: "visual-hades",
          shop: "steam",
          objectId: "1145350",
          gameTitle: "Hades II",
          gameIconUrl: iconDataUrl,
        },
        {
          id: "active-khazan",
          version: 4,
          createdAt: "2026-08-06T18:12:00.000Z",
          updatedAt: "2026-08-08T14:34:00.000Z",
          fileCount: 7,
          totalSizeBytes: 98_603_712,
          aggregateHash: "visual-khazan",
          shop: "custom",
          objectId: "khazan",
          gameTitle: "The First Berserker: Khazan",
          gameIconUrl: iconDataUrl,
        },
      ],
      game: {
        id: "visual-hades-ii",
        objectId: "1145350",
        remoteId: "1145350",
        shop: "steam",
        title: "Hades II",
        iconUrl: iconDataUrl,
        libraryImageUrl: iconDataUrl,
        libraryHeroImageUrl: bannerDataUrl,
        logoImageUrl: null,
        playTimeInMilliseconds: 44_280_000,
        lastTimePlayed: "2026-08-08T14:52:00.000Z",
        addedToLibraryAt: "2026-07-16T18:10:00.000Z",
        isDeleted: false,
        isInstalledLocally: true,
        executablePath: "C:\\Games\\Hades II\\Ship\\Hades2.exe",
        launchOptions: null,
        download: null,
        automaticCloudSync: true,
        libraryOrigin: "sync",
      },
      shopDetails: {
        name: "Hades II",
        steam_appid: 1145350,
        about_the_game:
          "Battle beyond the Underworld using dark sorcery and the might of the gods.",
        short_description: "The bewitching sequel to the god-like rogue-like.",
        detailed_description: "",
        legal_notice: "",
        developers: ["Supergiant Games"],
        publishers: ["Supergiant Games"],
        genres: [{ id: "1", description: "Action" }],
        categories: [],
        movies: [],
        screenshots: [],
        pc_requirements: { minimum: "", recommended: "" },
        mac_requirements: { minimum: "", recommended: "" },
        linux_requirements: { minimum: "", recommended: "" },
        release_date: { coming_soon: false, date: "May 6, 2024" },
        content_descriptors: { ids: [] },
        assets: {
          iconUrl: iconDataUrl,
          libraryImageUrl: iconDataUrl,
          libraryHeroImageUrl: bannerDataUrl,
          logoImageUrl: null,
        },
      },
      saveFolderPath: "C:\\Users\\GameHub\\Saved Games\\Hades II",
      cloudSaveOverview: {
        state: "synced",
        hasChanged: false,
        isAutomaticSyncEnabled: true,
        suggestedAction: "none",
        discoveredVariantCount: 1,
        unresolvedRemoteVariantCount: 0,
        unconfiguredCustomPathCount: 0,
        warnings: [],
        activeRemoteSnapshot: {
          id: "active-hades-ii",
          version: 12,
          createdAt: "2026-08-08T13:45:00.000Z",
          updatedAt: "2026-08-08T15:08:00.000Z",
          fileCount: 3,
          totalSizeBytes: 12_884_901,
          aggregateHash:
            "95f8623f755efec397f742fddfd1b84e79f23406b94e6769c86f73ab7c72b3db",
        },
      },
      cloudSaveFileDetails: {
        state: "synced",
        local: {
          kind: "local",
          fileCount: 3,
          totalSizeBytes: 12_884_901,
          files: [
            {
              source: "local",
              variantId: "visual-default",
              rawPath: "<winAppData>/Supergiant Games/Hades II",
              relativePath: "Profile1.sav",
              absolutePath:
                "C:\\Users\\GameHub\\AppData\\Roaming\\Supergiant Games\\Hades II\\Profile1.sav",
              sizeBytes: 8_724_211,
              lastModifiedAt: "2026-08-08T15:05:00.000Z",
              userLabel: "Main save",
            },
            {
              source: "local",
              variantId: "visual-default",
              rawPath: "<winAppData>/Supergiant Games/Hades II",
              relativePath: "Profile1.sav.bak",
              absolutePath:
                "C:\\Users\\GameHub\\AppData\\Roaming\\Supergiant Games\\Hades II\\Profile1.sav.bak",
              sizeBytes: 4_153_498,
              lastModifiedAt: "2026-08-08T14:42:00.000Z",
              userLabel: "Main save",
            },
            {
              source: "local",
              variantId: "visual-default",
              rawPath: "<custom>",
              relativePath: "settings.json",
              absolutePath: "C:\\Games\\Hades II\\GameHub Saves\\settings.json",
              sizeBytes: 7_192,
              lastModifiedAt: "2026-08-08T15:04:00.000Z",
              userLabel: "Custom location",
            },
          ],
        },
        activeSnapshot: {
          kind: "active-snapshot",
          snapshotId: "active-hades-ii",
          version: 12,
          updatedAt: "2026-08-08T15:08:00.000Z",
          fileCount: 3,
          totalSizeBytes: 12_884_901,
          files: [],
        },
        customPaths: [
          {
            rawPath: "<custom>",
            path: "C:\\Games\\Hades II\\GameHub Saves",
            platform: "windows",
          },
        ],
        unresolvedCustomPaths: [],
        comparisons: [],
        variants: [
          {
            variantId: "visual-default",
            userLabel: "This PC",
            fileCount: 3,
            conflictCount: 0,
            active: true,
            warningCodes: [],
          },
        ],
        unresolvedRemoteVariantCount: 0,
      },
      userDetails: {
        id: "visual-user",
        username: "gamehub",
        email: "visual@example.invalid",
        displayName: "GameHub Player",
        profileImageUrl: iconDataUrl,
        backgroundImageUrl: fallbackBannerDataUrl,
        profileVisibility: "PUBLIC",
        bio: "Games, clips, saves, and music in one place.",
        workwondersJwt: "",
        subscription: null,
        karma: 0,
        quirks: { backupsPerGameLimit: 10 },
      },
      profile: {
        id: "visual-user",
        displayName: "GameHub Player",
        profileImageUrl: iconDataUrl,
        email: "visual@example.invalid",
        backgroundImageUrl: fallbackBannerDataUrl,
        profileVisibility: "PUBLIC",
        libraryGames: [],
        recentGames: [],
        friends: [],
        totalFriends: 0,
        relation: null,
        currentGame: null,
        bio: "Games, clips, saves, and music in one place.",
        hasActiveSubscription: false,
        karma: 0,
        quirks: { backupsPerGameLimit: 10 },
        badges: [],
        hasCompletedWrapped2025: false,
      },
      profileGames: [
        {
          id: "visual-portal-2",
          objectId: "620",
          shop: "steam",
          title: "Portal 2",
          iconUrl: iconDataUrl,
          coverImageUrl: souvenirScreenshotDataUrl,
          libraryImageUrl: souvenirScreenshotDataUrl,
          libraryHeroImageUrl: souvenirScreenshotDataUrl,
          logoImageUrl: null,
          logoPosition: null,
          downloadSources: [],
          playTimeInSeconds: 221_760,
          playTimeInMilliseconds: 221_760_000,
          lastTimePlayed: "2026-08-28T22:15:00.000Z",
          unlockedAchievementCount: 42,
          achievementCount: 51,
          achievementsPointsEarnedSum: 420,
          hasManuallyUpdatedPlaytime: false,
          isFavorite: true,
          favorite: true,
          isPinned: false,
          isDeleted: false,
        },
        {
          id: "visual-control",
          objectId: "870780",
          shop: "steam",
          title: "Control Ultimate Edition",
          iconUrl: achievementIconDataUrl,
          coverImageUrl: bannerDataUrl,
          libraryImageUrl: bannerDataUrl,
          libraryHeroImageUrl: bannerDataUrl,
          logoImageUrl: null,
          logoPosition: null,
          downloadSources: [],
          playTimeInSeconds: 124_560,
          playTimeInMilliseconds: 124_560_000,
          lastTimePlayed: "2026-08-21T18:40:00.000Z",
          unlockedAchievementCount: 16,
          achievementCount: 67,
          achievementsPointsEarnedSum: 160,
          hasManuallyUpdatedPlaytime: false,
          isFavorite: false,
          favorite: false,
          isPinned: false,
          isDeleted: false,
        },
      ],
      achievementGames: [
        {
          objectId: "620",
          shop: "steam",
          title: "Portal 2",
          iconUrl: iconDataUrl,
          achievementCount: 51,
          unlockedAchievementCount: 42,
          inLibrary: true,
        },
        {
          objectId: "870780",
          shop: "steam",
          title: "Control Ultimate Edition",
          iconUrl: achievementIconDataUrl,
          achievementCount: 67,
          unlockedAchievementCount: 16,
          inLibrary: true,
        },
      ],
      achievementSouvenirs: [
        {
          ownerId: "visual-user",
          shop: "steam",
          objectId: "620",
          achievementName: "QA_VISUAL_SOUVENIR",
          achievementDisplayName: "Right on Time",
          achievementDescription:
            "Complete the test chamber before the clock runs out.",
          achievementIconUrl: achievementIconDataUrl,
          gameTitle: "Portal 2",
          gameIconUrl: iconDataUrl,
          imageUrl: souvenirScreenshotDataUrl,
          unlockTime: Date.parse("2026-08-29T01:42:00.000Z"),
        },
      ],
      r2ProfileImages: {
        profileImageUrl: iconDataUrl,
        backgroundImageUrl: bannerDataUrl,
      },
    }
  );

  await window
    .evaluate(() =>
      globalThis.window.electron.updateUserPreferences({
        onboardingComplete: true,
        themeMode: "dark",
      })
    )
    .catch(() => undefined);
  await window.reload();
  try {
    await window.waitForFunction(
      () => (document.getElementById("root")?.innerText.length ?? 0) > 10,
      undefined,
      { timeout: 20_000 }
    );
  } catch (error) {
    const diagnostic = await window
      .evaluate(() => ({
        href: globalThis.location.href,
        root: document.getElementById("root")?.innerHTML.slice(0, 1_000),
        body: document.body.innerText.slice(0, 1_000),
      }))
      .catch(() => ({ href: "unavailable", root: "", body: "" }));
    await window
      .screenshot({ path: path.join(outputDirectory, "startup-failure.png") })
      .catch(() => undefined);
    throw new Error(
      `GameHub renderer did not become ready: ${JSON.stringify({ diagnostic, rendererErrors, rendererConsoleErrors })}`,
      { cause: error }
    );
  }

  const assertInsideViewport = async (selector, checkVertical = false) => {
    const result = await window.evaluate(
      ({ targetSelector, checkY }) => {
        const target = document.querySelector(targetSelector);
        if (!target) return { exists: false, outside: [targetSelector] };
        const viewport = {
          left: 0,
          right: globalThis.innerWidth,
          top: 0,
          bottom: globalThis.innerHeight,
        };
        const outside = Array.from(target.querySelectorAll("*"))
          .filter((element) => {
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") {
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            return (
              rect.left < viewport.left - 1 ||
              rect.right > viewport.right + 1 ||
              (checkY &&
                (rect.top < viewport.top - 1 ||
                  rect.bottom > viewport.bottom + 1))
            );
          })
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${String(element.className)}`
          );
        return { exists: true, outside };
      },
      { targetSelector: selector, checkY: checkVertical }
    );
    if (!result.exists || result.outside.length > 0) {
      const diagnostic = await window.evaluate(() => ({
        hash: globalThis.location.hash,
        bodyText: document.body.innerText.slice(0, 1_200),
      }));
      throw new Error(
        `${selector} is clipped or outside the viewport: ${JSON.stringify({ result, diagnostic })}`
      );
    }
  };

  const movePointerOffContent = async () => {
    const viewport = window.viewportSize();
    if (!viewport) return;
    await window.mouse.move(viewport.width - 2, viewport.height - 2);
  };

  const visit = async ({ route, ready, file, validate = ready }) => {
    await window.evaluate((nextRoute) => {
      globalThis.location.hash = nextRoute;
    }, route);
    await window
      .locator(ready)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await assertInsideViewport(validate);
    await movePointerOffContent();
    const output = path.join(outputDirectory, file);
    await window.screenshot({ path: output });
    console.log(`captured ${output}`);
  };

  const setCloudLibraryMode = (mode) =>
    electronApp.evaluate((_electron, nextMode) => {
      globalThis.__gameHubVisualQaCloudLibraryMode = nextMode;
    }, mode);

  const waitForOpenSaveFolderCall = async ({
    shop,
    objectId,
    saveFolderPath,
  }) => {
    const expected = { shop, objectId, saveFolderPath };
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      const matched = await electronApp.evaluate(
        (_electron, candidate) =>
          globalThis.__gameHubVisualQaOpenSaveFolderCalls.some(
            (call) =>
              call.shop === candidate.shop &&
              call.objectId === candidate.objectId &&
              call.saveFolderPath === candidate.saveFolderPath
          ),
        expected
      );
      if (matched) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(
      `openGameSaveFolder was not invoked with ${JSON.stringify(expected)}`
    );
  };

  const captureCloudLibraryState = async ({
    mode,
    route,
    awayRoute,
    ready,
    file,
    viewport,
    validate,
  }) => {
    await setCloudLibraryMode(mode);
    await window.setViewportSize(viewport);
    // Chromium briefly paints its native viewport-size badge after an Electron
    // resize. Wait for that transient diagnostic to disappear before proof.
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    await window.evaluate((nextRoute) => {
      globalThis.location.hash = nextRoute;
    }, awayRoute);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await window.evaluate((nextRoute) => {
      globalThis.location.hash = nextRoute;
    }, route);
    await window.locator(ready).first().waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await assertInsideViewport(validate);
    await movePointerOffContent();
    const output = path.join(outputDirectory, file);
    await window.screenshot({ path: output });
    console.log(`captured ${output}`);
  };

  await visit({
    route: "/cloud-saves",
    ready: ".cloud-saves__list",
    file: "cloud-saves-desktop.png",
    validate: ".cloud-saves",
  });
  await window.locator(".cloud-saves__entry-actions button").first().click();
  await window
    .locator(".cloud-save-v2__modal")
    .waitFor({ state: "visible", timeout: 15_000 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const desktopManagerState = await window.evaluate(() => ({
    hash: globalThis.location.hash,
    managerCount: document.querySelectorAll(".cloud-save-v2__modal").length,
    bodyText: document.body.innerText.slice(0, 1_000),
  }));
  if (desktopManagerState.managerCount === 0) {
    throw new Error(
      `Desktop Cloud Saves manager did not remain open: ${JSON.stringify(desktopManagerState)}`
    );
  }
  await assertInsideViewport(".cloud-save-v2__modal", true);
  await window.screenshot({
    path: path.join(outputDirectory, "cloud-saves-manage-navigation.png"),
  });
  await visit({
    route: "/downloads",
    ready: "#downloads-manager-tab-custom",
    file: "download-manager-desktop.png",
    validate: ".downloads__page",
  });
  await window.locator("#downloads-manager-tab-downloads").focus();
  await window.keyboard.press("ArrowRight");
  await window.waitForFunction(
    () =>
      document.activeElement?.id === "downloads-manager-tab-custom" &&
      document
        .getElementById("downloads-manager-tab-custom")
        ?.getAttribute("aria-selected") === "true"
  );
  await window.locator("#downloads-manager-panel-custom").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await assertInsideViewport(".downloads__page");
  await window.screenshot({
    path: path.join(outputDirectory, "download-manager-add-custom-desktop.png"),
  });
  await window.locator(".downloads__custom-options button").first().click();
  await window
    .locator(".custom-download-modal")
    .waitFor({ state: "visible", timeout: 10_000 });
  if (
    !(await window
      .locator('.custom-download-modal button[type="submit"]')
      .isDisabled())
  ) {
    throw new Error("Desktop empty custom-download form can be submitted.");
  }
  await assertInsideViewport(".custom-download-modal", true);
  await window.screenshot({
    path: path.join(outputDirectory, "custom-download-modal-desktop.png"),
  });

  await visit({
    route: "/big-picture/cloud-saves",
    ready: ".cloud-saves-page__list",
    file: "cloud-saves-big-picture.png",
    validate: ".cloud-saves-page",
  });
  await visit({
    route: "/big-picture/downloads",
    ready: "#downloads-manager-tab-custom-bp",
    file: "download-manager-big-picture.png",
    validate: ".downloads-page",
  });
  const bigPictureTabFocusContract = await window.evaluate(() =>
    [
      "downloads-manager-tab-downloads-bp",
      "downloads-manager-tab-custom-bp",
    ].map((id) => ({
      id,
      exists: document.getElementById(id) !== null,
      state: document.getElementById(id)?.getAttribute("data-navigation-state"),
    }))
  );
  if (
    bigPictureTabFocusContract.some(
      ({ exists, state }) => !exists || state === "hidden"
    )
  ) {
    throw new Error(
      `Big Picture download-tab focus contract failed: ${JSON.stringify(bigPictureTabFocusContract)}`
    );
  }
  await window.locator("#downloads-manager-tab-custom-bp").click();
  await window.locator("#downloads-manager-panel-custom-bp").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  const bigPictureCustomFocusContract = await window.evaluate(() =>
    [
      "downloads-custom-link",
      "downloads-custom-magnet",
      "downloads-custom-torrent",
    ].map((id) => ({
      id,
      exists: document.getElementById(id) !== null,
      state: document.getElementById(id)?.getAttribute("data-navigation-state"),
    }))
  );
  if (
    bigPictureCustomFocusContract.some(
      ({ exists, state }) => !exists || state === "hidden"
    )
  ) {
    throw new Error(
      `Big Picture custom-download focus contract failed: ${JSON.stringify(bigPictureCustomFocusContract)}`
    );
  }
  await assertInsideViewport(".downloads-page");
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "download-manager-add-custom-big-picture.png"
    ),
  });
  await window.locator(".downloads-page__custom-option").first().click();
  await window
    .locator(".bp-custom-download-modal")
    .waitFor({ state: "visible", timeout: 10_000 });
  if (!(await window.locator("#custom-download-submit").isDisabled())) {
    throw new Error("Big Picture empty custom-download form can be submitted.");
  }
  await assertInsideViewport(".bp-custom-download-modal", true);
  await window.screenshot({
    path: path.join(outputDirectory, "custom-download-modal-big-picture.png"),
  });

  await window.evaluate(() => {
    globalThis.location.hash = "/profile/visual-user";
  });
  await window
    .locator(".profile__wrapper")
    .waitFor({ state: "visible", timeout: 20_000 });
  await window.waitForFunction(
    (expectedSrc) => {
      const image = document.querySelector(".profile-hero__background-image");
      return (
        image instanceof HTMLImageElement &&
        image.getAttribute("src") === expectedSrc &&
        image.complete &&
        image.naturalWidth > 0
      );
    },
    bannerDataUrl,
    { timeout: 10_000 }
  );
  await assertInsideViewport(".profile__wrapper");
  await window.screenshot({
    path: path.join(outputDirectory, "profile-banner-r2-hydration.png"),
  });

  await window.setViewportSize({ width: 1920, height: 1080 });
  // Chromium briefly paints a native viewport-size badge after an Electron
  // resize. Keep it out of proof screenshots without masking app content.
  await window.waitForTimeout(1_250);
  const desktopAchievementStat = window.locator(
    'button[title="Open achievements tab"]'
  );
  await desktopAchievementStat.waitFor({ state: "visible", timeout: 20_000 });
  await desktopAchievementStat.click();
  await window
    .locator(".profile-achievements")
    .waitFor({ state: "visible", timeout: 20_000 });
  const desktopAchievementState = await window.evaluate(() => ({
    activeTab: document
      .querySelector(".profile-content__tab--active")
      ?.textContent?.trim(),
    obsoletePopupCount: document.querySelectorAll(".achievements-breakdown")
      .length,
    summary: document
      .querySelector(".profile-achievements__summary")
      ?.textContent?.replace(/\s+/g, " ")
      .trim(),
  }));
  if (
    desktopAchievementState.activeTab !== "Achievements" ||
    desktopAchievementState.obsoletePopupCount !== 0 ||
    !desktopAchievementState.summary?.includes("58 unlocked across 2 games")
  ) {
    throw new Error(
      `Desktop achievement stat did not open the achievement tab: ${JSON.stringify(desktopAchievementState)}`
    );
  }
  await assertInsideViewport(".profile__wrapper");
  await movePointerOffContent();
  await window.screenshot({
    path: path.join(outputDirectory, "profile-achievements-stat-desktop.png"),
  });

  const desktopSouvenirsTab = window
    .locator(".profile-content__tab")
    .filter({ hasText: /^Souvenirs/ });
  await desktopSouvenirsTab.click();
  const desktopSouvenirPreview = window.getByRole("button", {
    name: "View Right on Time souvenir",
  });
  await desktopSouvenirPreview.waitFor({ state: "visible", timeout: 20_000 });
  const desktopSouvenirProof = await window.evaluate((expectedIcon) => {
    const notification = document.querySelector(
      ".profile-souvenirs__notification"
    );
    const icon = document.querySelector(".profile-souvenirs__achievement-icon");
    const preview = document.querySelector(".profile-souvenirs__preview > img");
    const notificationCopy = document.querySelector(
      ".profile-souvenirs__notification-copy"
    );
    const iconBounds = icon?.getBoundingClientRect();
    const notificationBounds = notification?.getBoundingClientRect();
    const previewBounds = preview?.getBoundingClientRect();
    const notificationCopyBounds = notificationCopy?.getBoundingClientRect();
    return {
      notificationText: notification?.textContent?.replace(/\s+/g, " ").trim(),
      iconMatches:
        icon instanceof HTMLImageElement &&
        icon.getAttribute("src") === expectedIcon &&
        icon.complete &&
        icon.naturalWidth > 0,
      screenshotDecoded:
        preview instanceof HTMLImageElement &&
        preview.complete &&
        preview.naturalWidth > 0,
      iconBounds: iconBounds
        ? { width: iconBounds.width, height: iconBounds.height }
        : null,
      notificationVisibleWithinPreview: Boolean(
        notificationBounds &&
          previewBounds &&
          notificationCopyBounds &&
          notificationBounds.width > 0 &&
          notificationBounds.height > 0 &&
          notificationCopyBounds.width > 0 &&
          notificationCopyBounds.height > 0 &&
          notificationBounds.left >= previewBounds.left - 1 &&
          notificationBounds.right <= previewBounds.right + 1 &&
          notificationBounds.top >= previewBounds.top - 1 &&
          notificationBounds.bottom <= previewBounds.bottom + 1 &&
          getComputedStyle(notification).visibility === "visible"
      ),
    };
  }, achievementIconDataUrl);
  if (
    !desktopSouvenirProof.iconMatches ||
    !desktopSouvenirProof.screenshotDecoded ||
    !desktopSouvenirProof.notificationVisibleWithinPreview ||
    !desktopSouvenirProof.iconBounds ||
    desktopSouvenirProof.iconBounds.width < 36 ||
    desktopSouvenirProof.iconBounds.width > 40 ||
    desktopSouvenirProof.iconBounds.height < 36 ||
    desktopSouvenirProof.iconBounds.height > 40 ||
    !desktopSouvenirProof.notificationText?.includes("Right on Time") ||
    !desktopSouvenirProof.notificationText?.includes(
      "Complete the test chamber before the clock runs out."
    )
  ) {
    throw new Error(
      `Desktop souvenir metadata is incomplete: ${JSON.stringify(desktopSouvenirProof)}`
    );
  }
  await assertInsideViewport(".profile-souvenirs");
  await movePointerOffContent();
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "profile-souvenirs-achievement-overlay-desktop.png"
    ),
  });

  await desktopSouvenirPreview.click();
  const desktopSouvenirLightbox = window.locator(".fullscreen-media-modal");
  await desktopSouvenirLightbox.waitFor({ state: "visible", timeout: 10_000 });
  await window.screenshot({
    path: path.join(outputDirectory, "profile-souvenir-lightbox-desktop.png"),
  });
  await window.keyboard.press("Escape");
  await desktopSouvenirLightbox.waitFor({ state: "hidden", timeout: 10_000 });
  if (
    !(await desktopSouvenirPreview.evaluate(
      (preview) => document.activeElement === preview
    ))
  ) {
    throw new Error(
      "Desktop souvenir lightbox did not restore focus to its preview."
    );
  }

  await window.evaluate(() => {
    globalThis.location.hash = "/big-picture/profile";
  });
  await window
    .locator(".bp-profile")
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.waitForFunction(
    () =>
      document
        .querySelector(".bp-profile")
        ?.getAttribute("data-profile-ready") === "true",
    undefined,
    { timeout: 30_000 }
  );
  await installMockXboxGamepad(window);
  await focusBigPictureItem(
    window,
    "#profile-achievements-stat",
    "profile-achievements-stat"
  );
  await pressGamepadButton(window, GAMEPAD_BUTTON.a);
  await window.waitForFunction(
    () =>
      document
        .querySelector(".bp-profile")
        ?.getAttribute("data-profile-view") === "achievements"
  );
  const bigPictureAchievementState = await window.evaluate(() => ({
    focusedId:
      document.querySelector("[data-focus-visible='true']")?.id ?? null,
    obsoletePopupCount: document.querySelectorAll(".achievements-breakdown")
      .length,
    heading: document
      .querySelector(".bp-profile__section__title")
      ?.textContent?.trim(),
    gameCount: document.querySelectorAll(".bp-profile__game").length,
  }));
  if (
    bigPictureAchievementState.focusedId !== "profile-tab-achievements" ||
    bigPictureAchievementState.obsoletePopupCount !== 0 ||
    bigPictureAchievementState.heading !== "Achievements" ||
    bigPictureAchievementState.gameCount !== 2
  ) {
    throw new Error(
      `Big Picture controller achievement navigation failed: ${JSON.stringify(bigPictureAchievementState)}`
    );
  }
  await assertInsideViewport(".bp-profile");
  await movePointerOffContent();
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "profile-achievements-stat-controller-big-picture.png"
    ),
  });

  await pressGamepadButton(window, GAMEPAD_BUTTON.right);
  await window.waitForFunction(
    () =>
      document
        .querySelector(".bp-profile")
        ?.getAttribute("data-profile-view") === "souvenirs"
  );
  const bigPictureTabFocus = await window.evaluate(
    () => document.querySelector("[data-focus-visible='true']")?.id ?? null
  );
  if (bigPictureTabFocus !== "profile-tab-souvenirs") {
    throw new Error(
      `Controller Right did not reach Souvenirs; focus is ${bigPictureTabFocus ?? "none"}.`
    );
  }
  const bigPictureSouvenirId = "profile-souvenir:steam:620:QA_VISUAL_SOUVENIR";
  await focusBigPictureItem(
    window,
    "#profile-souvenir\\:steam\\:620\\:QA_VISUAL_SOUVENIR",
    bigPictureSouvenirId
  );
  const bigPictureSouvenirProof = await window.evaluate((expectedIcon) => {
    const notification = document.querySelector(
      ".bp-profile__souvenir__notification"
    );
    const icon = document.querySelector(
      ".bp-profile__souvenir__achievement-icon"
    );
    const preview = document.querySelector(".bp-profile__souvenir__image");
    const notificationCopy = document.querySelector(
      ".bp-profile__souvenir__notification-copy"
    );
    const iconBounds = icon?.getBoundingClientRect();
    const notificationBounds = notification?.getBoundingClientRect();
    const previewBounds = preview?.getBoundingClientRect();
    const notificationCopyBounds = notificationCopy?.getBoundingClientRect();
    return {
      notificationText: notification?.textContent?.replace(/\s+/g, " ").trim(),
      iconMatches:
        icon instanceof HTMLImageElement &&
        icon.getAttribute("src") === expectedIcon &&
        icon.complete &&
        icon.naturalWidth > 0,
      screenshotDecoded:
        preview instanceof HTMLImageElement &&
        preview.complete &&
        preview.naturalWidth > 0,
      iconBounds: iconBounds
        ? { width: iconBounds.width, height: iconBounds.height }
        : null,
      notificationVisibleWithinPreview: Boolean(
        notificationBounds &&
          previewBounds &&
          notificationCopyBounds &&
          notificationBounds.width > 0 &&
          notificationBounds.height > 0 &&
          notificationCopyBounds.width > 0 &&
          notificationCopyBounds.height > 0 &&
          notificationBounds.left >= previewBounds.left - 1 &&
          notificationBounds.right <= previewBounds.right + 1 &&
          notificationBounds.top >= previewBounds.top - 1 &&
          notificationBounds.bottom <= previewBounds.bottom + 1 &&
          getComputedStyle(notification).visibility === "visible"
      ),
    };
  }, achievementIconDataUrl);
  if (
    !bigPictureSouvenirProof.iconMatches ||
    !bigPictureSouvenirProof.screenshotDecoded ||
    !bigPictureSouvenirProof.notificationVisibleWithinPreview ||
    !bigPictureSouvenirProof.iconBounds ||
    bigPictureSouvenirProof.iconBounds.width < 38 ||
    bigPictureSouvenirProof.iconBounds.width > 42 ||
    bigPictureSouvenirProof.iconBounds.height < 38 ||
    bigPictureSouvenirProof.iconBounds.height > 42 ||
    !bigPictureSouvenirProof.notificationText?.includes("Right on Time") ||
    !bigPictureSouvenirProof.notificationText?.includes(
      "Complete the test chamber before the clock runs out."
    )
  ) {
    throw new Error(
      `Big Picture souvenir metadata is incomplete: ${JSON.stringify(bigPictureSouvenirProof)}`
    );
  }
  await assertInsideViewport(".bp-profile");
  await movePointerOffContent();
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "profile-souvenirs-achievement-overlay-controller-big-picture.png"
    ),
  });

  await pressGamepadButton(window, GAMEPAD_BUTTON.a);
  const bigPictureSouvenirLightbox = window.locator(".image-lightbox__surface");
  await bigPictureSouvenirLightbox.waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "profile-souvenir-lightbox-controller-big-picture.png"
    ),
  });
  await pressGamepadButton(window, GAMEPAD_BUTTON.b);
  await bigPictureSouvenirLightbox.waitFor({
    state: "hidden",
    timeout: 10_000,
  });
  const restoredBigPictureFocus = await window.evaluate(
    () => document.querySelector("[data-focus-visible='true']")?.id ?? null
  );
  if (restoredBigPictureFocus !== bigPictureSouvenirId) {
    throw new Error(
      `Big Picture souvenir lightbox restored ${restoredBigPictureFocus ?? "no"} focus instead of ${bigPictureSouvenirId}.`
    );
  }
  console.log(
    "asserted profile achievements and souvenir icon/title/description flows with desktop pointer/keyboard and Big Picture gamepad A/B/Right input"
  );

  await visit({
    route: "/game/steam/1145350?title=Hades%20II",
    ready: ".game-details__container",
    file: "game-details-visual-fixture.png",
    validate: ".game-details__container",
  });
  await window.evaluate(() => {
    globalThis.dispatchEvent(
      new CustomEvent("hydra:openGameOptions", {
        detail: { objectId: "1145350" },
      })
    );
  });
  await window
    .locator(".game-options-modal__container")
    .waitFor({ state: "visible", timeout: 10_000 });
  const exophaseLookupButton = window.getByRole("button", {
    name: "Look up achievements on Exophase",
  });
  await exophaseLookupButton.waitFor({ state: "visible", timeout: 10_000 });
  const exophaseButtonProof = await exophaseLookupButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      className: button.className,
      minHeight: button.getBoundingClientRect().height,
      borderStyle: style.borderStyle,
      borderRadius: style.borderRadius,
    };
  });
  if (
    !String(exophaseButtonProof.className).split(/\s+/).includes("button") ||
    !String(exophaseButtonProof.className)
      .split(/\s+/)
      .includes("button--outline") ||
    exophaseButtonProof.borderStyle === "none"
  ) {
    throw new Error(
      `Exophase lookup is not using the shared styled Button: ${JSON.stringify(exophaseButtonProof)}`
    );
  }
  await assertInsideViewport(".game-options-modal__container", true);
  await window.screenshot({
    path: path.join(outputDirectory, "game-options-exophase.png"),
  });
  await window
    .locator(".game-options-modal__sidebar-button", { hasText: "Locations" })
    .click();
  const desktopOpenSaveFolderButton = window.getByRole("button", {
    name: "Open save folder",
    exact: true,
  });
  await desktopOpenSaveFolderButton.waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await desktopOpenSaveFolderButton.click();
  await waitForOpenSaveFolderCall({
    shop: "steam",
    objectId: "1145350",
    saveFolderPath: "C:\\Users\\GameHub\\Saved Games\\Hades II",
  });
  await window
    .locator(".game-options-modal__sidebar-button", {
      hasText: "Cloud Saves",
    })
    .click();
  await window
    .locator(".game-options-modal__cloud-panel")
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertInsideViewport(".game-options-modal__container", true);
  await window.screenshot({
    path: path.join(outputDirectory, "game-options-cloud-saves.png"),
  });

  await window.locator(".cloud-save-v2__snapshot-stats--interactive").click();
  await window
    .locator(".cloud-save-v2__file-browser-modal")
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertInsideViewport(".cloud-save-v2__file-browser-modal", true);
  await window.screenshot({
    path: path.join(outputDirectory, "game-options-save-file-mapper.png"),
  });
  const desktopFileMapperOpenButtons = window.locator(
    '.cloud-save-v2__file-browser-modal .cloud-save-v2__browser-path-action[title="Open folder"]'
  );
  await desktopFileMapperOpenButtons.nth(0).click();
  await waitForOpenSaveFolderCall({
    shop: "steam",
    objectId: "1145350",
    saveFolderPath: "C:\\Games\\Hades II\\GameHub Saves",
  });
  await desktopFileMapperOpenButtons.nth(1).click();
  await waitForOpenSaveFolderCall({
    shop: "steam",
    objectId: "1145350",
    saveFolderPath:
      "C:\\Users\\GameHub\\AppData\\Roaming\\Supergiant Games\\Hades II",
  });

  await visit({
    route: "/big-picture/game/steam/1145350?title=Hades%20II",
    ready: ".game-page",
    file: "game-details-big-picture-visual-fixture.png",
    validate: ".game-page",
  });
  await window.locator("#game-hero-open-settings").click();
  await window
    .locator('[data-sidebar-modal][data-active-sidebar-tab="launch"]')
    .waitFor({ state: "visible", timeout: 10_000 });
  const bigPictureOpenSaveFolderButton = window.getByRole("button", {
    name: "Open save folder",
    exact: true,
  });
  await bigPictureOpenSaveFolderButton.waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await bigPictureOpenSaveFolderButton.click();
  await waitForOpenSaveFolderCall({
    shop: "steam",
    objectId: "1145350",
    saveFolderPath: "C:\\Users\\GameHub\\Saved Games\\Hades II",
  });
  await window.locator('[data-sidebar-tab-id="hydra_cloud"]').click();
  await window
    .locator('[data-sidebar-panel-id="hydra_cloud"]')
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertInsideViewport("[data-sidebar-modal]", true);
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "game-settings-cloud-saves-big-picture.png"
    ),
  });
  await window
    .locator('[data-sidebar-panel-id="hydra_cloud"] button', {
      hasText: "Open Cloud Saves",
    })
    .click();
  await window
    .locator(".big-picture-cloud-save-modal")
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertInsideViewport(".big-picture-cloud-save-modal", true);
  await window.screenshot({
    path: path.join(outputDirectory, "cloud-save-manager-big-picture.png"),
  });
  await window
    .locator(".big-picture-cloud-save-modal button", {
      hasText: "Manage save locations",
    })
    .click();
  await window
    .locator(".big-picture-cloud-save-details-modal")
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertInsideViewport(".big-picture-cloud-save-details-modal", true);
  await window.screenshot({
    path: path.join(
      outputDirectory,
      "game-options-save-file-mapper-big-picture.png"
    ),
  });

  await captureCloudLibraryState({
    mode: "success",
    route: "/cloud-saves",
    awayRoute: "/downloads",
    ready: ".cloud-saves__list",
    file: "cloud-saves-desktop-1280x720.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves",
  });
  await setCloudLibraryMode("error");
  await window.locator(".cloud-saves__filter-clear").click();
  await window
    .locator(".cloud-saves__load-error")
    .waitFor({ state: "visible", timeout: 10_000 });
  await window
    .locator(".cloud-saves__list")
    .waitFor({ state: "visible", timeout: 10_000 });
  await assertInsideViewport(".cloud-saves");
  await window.screenshot({
    path: path.join(outputDirectory, "cloud-saves-desktop-stale-retry.png"),
  });
  await captureCloudLibraryState({
    mode: "error",
    route: "/cloud-saves",
    awayRoute: "/downloads",
    ready: ".cloud-saves__load-error",
    file: "cloud-saves-desktop-error.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves",
  });
  await captureCloudLibraryState({
    mode: "empty",
    route: "/cloud-saves",
    awayRoute: "/downloads",
    ready: ".cloud-saves__empty",
    file: "cloud-saves-desktop-empty.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves",
  });
  await captureCloudLibraryState({
    mode: "loading",
    route: "/cloud-saves",
    awayRoute: "/downloads",
    ready: '.cloud-saves [role="status"]',
    file: "cloud-saves-desktop-loading.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves",
  });
  await captureCloudLibraryState({
    mode: "success",
    route: "/big-picture/cloud-saves",
    awayRoute: "/big-picture/downloads",
    ready: ".cloud-saves-page__list",
    file: "cloud-saves-big-picture-1280x720.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves-page",
  });
  await captureCloudLibraryState({
    mode: "empty",
    route: "/big-picture/cloud-saves",
    awayRoute: "/big-picture/downloads",
    ready: ".cloud-saves-page__empty",
    file: "cloud-saves-big-picture-empty.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves-page",
  });
  await captureCloudLibraryState({
    mode: "loading",
    route: "/big-picture/cloud-saves",
    awayRoute: "/big-picture/downloads",
    ready: '.cloud-saves-page [role="status"]',
    file: "cloud-saves-big-picture-loading.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves-page",
  });
  await captureCloudLibraryState({
    mode: "error",
    route: "/big-picture/cloud-saves",
    awayRoute: "/big-picture/downloads",
    ready: ".cloud-saves-page__error",
    file: "cloud-saves-big-picture-error.png",
    viewport: { width: 1280, height: 720 },
    validate: ".cloud-saves-page",
  });
  await captureCloudLibraryState({
    mode: "success",
    route: "/big-picture/cloud-saves",
    awayRoute: "/big-picture/downloads",
    ready: ".cloud-saves-page__list",
    file: "cloud-saves-big-picture-ultrawide.png",
    viewport: { width: 2560, height: 1080 },
    validate: ".cloud-saves-page",
  });

  if (rendererErrors.length > 0) {
    throw new Error(`Renderer errors: ${rendererErrors.join(" | ")}`);
  }
  const benignConsoleErrorPatterns = [
    /Failed to load resource.*external-resources/i,
    /Failed to load resource.*out\/renderer\/undefined\/bundle\.js/i,
    /net::ERR_(?:NAME_NOT_RESOLVED|CONNECTION_REFUSED)/i,
  ];
  const unexpectedConsoleErrors = rendererConsoleErrors.filter(
    (message) =>
      !benignConsoleErrorPatterns.some((pattern) => pattern.test(message))
  );
  if (unexpectedConsoleErrors.length > 0) {
    throw new Error(
      `Unexpected renderer console errors: ${unexpectedConsoleErrors.join(" | ")}`
    );
  }

  const openSaveFolderCalls = await electronApp.evaluate(
    () => globalThis.__gameHubVisualQaOpenSaveFolderCalls
  );
  console.log(
    `asserted openGameSaveFolder IPC calls: ${JSON.stringify(openSaveFolderCalls)}`
  );
} finally {
  await electronApp.close().catch(() => undefined);
  await fs.promises
    .rm(isolatedProfile, { recursive: true, force: true })
    .catch(() => undefined);
}
