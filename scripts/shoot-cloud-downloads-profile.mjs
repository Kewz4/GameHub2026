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
        updateCheckerProceeded = true;
        await checker
          .evaluate(() => globalThis.window.electron.updateCheckerProceed())
          .catch(() => undefined);
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
      replaceHandler("getUnlockedAchievements", async () => []);
      replaceHandler("getGameSaveFolder", async () => fixture.saveFolderPath);
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
} finally {
  await electronApp.close().catch(() => undefined);
  await fs.promises
    .rm(isolatedProfile, { recursive: true, force: true })
    .catch(() => undefined);
}
