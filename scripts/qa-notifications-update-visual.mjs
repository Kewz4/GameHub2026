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
  path.join(os.tmpdir(), "gamehub-notification-visual-qa-")
);

for (const required of [electronExecutable, mainEntry]) {
  if (!fs.existsSync(required)) throw new Error(`Missing ${required}`);
}
await fs.promises.mkdir(outputDirectory, { recursive: true });

const svgDataUrl = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const playerImage = svgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="18" fill="#dedede"/>
    <circle cx="48" cy="38" r="17" fill="#222"/>
    <path d="M17 88c4-21 16-31 31-31s27 10 31 31" fill="#222"/>
  </svg>
`);

const now = Date.now();
const fixture = {
  user: {
    id: "visual-notifications-user",
    username: "gamehub",
    email: "visual@example.invalid",
    displayName: "GameHub Player",
    profileImageUrl: playerImage,
    backgroundImageUrl: null,
    profileVisibility: "PUBLIC",
    bio: "",
    workwondersJwt: "",
    subscription: null,
    karma: 0,
    quirks: { backupsPerGameLimit: 10 },
  },
  localNotifications: [
    {
      id: "achievement-sync",
      type: "ACHIEVEMENTS_SYNC_COMPLETE",
      title: "Achievements sync finished",
      description: "29 new achievements across 4 games",
      pictureUrl: null,
      url: "/profile/visual-notifications-user?content=achievements",
      isRead: false,
      createdAt: new Date(now - 3 * 60_000).toISOString(),
    },
    {
      id: "update-ready",
      type: "UPDATE_AVAILABLE",
      title: "GameHub 1.1.46 is available",
      description: "View the release and download the update",
      pictureUrl: null,
      url: null,
      isRead: false,
      createdAt: new Date(now - 7 * 60_000).toISOString(),
    },
    {
      id: "achievement-unlocked",
      type: "ACHIEVEMENT_UNLOCKED",
      title: "Achievement unlocked",
      description: "The Unseen Blade · The First Berserker: Khazan",
      pictureUrl: null,
      url: "/profile/visual-notifications-user?content=souvenirs",
      isRead: true,
      createdAt: new Date(now - 55 * 60_000).toISOString(),
    },
    {
      id: "cloud-upload",
      type: "DOWNLOAD_COMPLETE",
      title: "Cloud save uploaded",
      description: "Hades II is protected by Cloud Saves V2",
      pictureUrl: null,
      url: "/cloud-saves",
      isRead: true,
      createdAt: new Date(now - 3 * 60 * 60_000).toISOString(),
    },
  ],
  apiNotifications: [
    {
      id: "friend-request",
      type: "FRIEND_REQUEST_RECEIVED",
      variables: {
        senderId: "visual-friend",
        senderDisplayName: "Aloy",
      },
      pictureUrl: playerImage,
      url: "/profile?userId=visual-friend",
      isRead: false,
      priority: 1,
      createdAt: new Date(now - 20 * 60_000).toISOString(),
    },
  ],
};

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

const pageErrors = [];
const consoleErrors = [];

try {
  await electronApp.firstWindow({ timeout: 40_000 });

  let window;
  let checkerHandled = false;
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

    if (!checkerHandled && attempt > 8) {
      const checker = electronApp
        .windows()
        .find((candidate) => candidate.url().includes("update-checker"));
      if (checker) {
        try {
          await checker.evaluate(() => window.electron.updateCheckerProceed());
          checkerHandled = true;
        } catch {
          if (attempt > 32) {
            await electronApp.evaluate(({ BrowserWindow }) => {
              BrowserWindow.getAllWindows()
                .find((candidate) =>
                  candidate.webContents.getURL().includes("update-checker")
                )
                ?.close();
            });
            checkerHandled = true;
          }
        }
      }
    }
  }

  if (!window) throw new Error("The main GameHub window did not open.");

  window.on("pageerror", (error) => pageErrors.push(String(error)));
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await window.setViewportSize({ width: 1440, height: 900 });

  await electronApp.evaluate(({ ipcMain }, data) => {
    const replaceHandler = (channel, handler) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    };

    replaceHandler("getMe", async () => data.user);
    replaceHandler(
      "getLocalNotifications",
      async () => data.localNotifications
    );
    replaceHandler(
      "getLocalNotificationsCount",
      async () =>
        data.localNotifications.filter((notification) => !notification.isRead)
          .length
    );
    replaceHandler("markLocalNotificationRead", async () => true);
    replaceHandler("markAllLocalNotificationsRead", async () => true);
    replaceHandler("deleteLocalNotification", async () => true);
    replaceHandler("clearAllLocalNotifications", async () => true);
    replaceHandler("checkForUpdates", async () => false);
    replaceHandler("restartAndInstallUpdate", async () => undefined);
    replaceHandler("hydraApiCall", async (_event, payload) => {
      const url = String(payload?.url ?? "");
      if (url === "/profile/notifications") {
        return {
          notifications: data.apiNotifications,
          pagination: {
            total: data.apiNotifications.length,
            take: 20,
            skip: 0,
            hasMore: false,
          },
        };
      }
      if (url.startsWith("/badges?")) return [];
      if (url === "/profile/notifications/count") {
        return {
          count: data.apiNotifications.filter(
            (notification) => !notification.isRead
          ).length,
        };
      }
      return {};
    });
  }, fixture);

  await window
    .evaluate(() =>
      window.electron.updateUserPreferences({
        onboardingComplete: true,
        themeMode: "dark",
      })
    )
    .catch(() => undefined);
  await window.reload();
  await window.waitForFunction(
    () => (document.getElementById("root")?.innerText.length ?? 0) > 10,
    undefined,
    { timeout: 20_000 }
  );

  await window.evaluate(() => {
    globalThis.location.hash = "/notifications";
  });
  await window.locator(".notifications__list").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await window.waitForFunction(
    () => document.querySelectorAll(".notification-item").length === 5,
    undefined,
    { timeout: 10_000 }
  );
  await new Promise((resolve) => setTimeout(resolve, 500));

  const notificationPresentation = await window.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".notification-item"));
    const firstIcon = document.querySelector(".notification-item__picture svg");
    return {
      rowCount: rows.length,
      rows: rows.map((row) => {
        const style = getComputedStyle(row);
        return {
          borderRadius: style.borderRadius,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
          borderBottomWidth: style.borderBottomWidth,
        };
      }),
      firstIconColor: firstIcon ? getComputedStyle(firstIcon).color : null,
    };
  });

  if (
    notificationPresentation.rows.some(
      (row) =>
        row.borderRadius !== "0px" ||
        row.borderLeftWidth !== "0px" ||
        row.borderRightWidth !== "0px" ||
        row.borderBottomWidth === "0px"
    )
  ) {
    throw new Error(
      `Notifications regressed to card-in-card styling: ${JSON.stringify(notificationPresentation)}`
    );
  }
  if (
    /rgb\(\s*(?:0|[1-9]\d?)\s*,\s*(?:1[2-9]\d|2\d\d)\s*,/.test(
      notificationPresentation.firstIconColor ?? ""
    )
  ) {
    throw new Error(
      `Notification icon unexpectedly uses a green accent: ${JSON.stringify(notificationPresentation)}`
    );
  }

  const notificationsPath = path.join(
    outputDirectory,
    "notifications-desktop-populated.png"
  );
  await window.screenshot({ path: notificationsPath });
  console.log(`captured ${notificationsPath}`);
  console.log(
    `notification presentation: ${JSON.stringify(notificationPresentation)}`
  );

  await electronApp.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes("/out/renderer/index.html")
    );
    target?.webContents.send("autoUpdaterEvent", {
      type: "update-available",
      info: { version: "1.1.46" },
    });
  });
  await window.locator(".auto-update-sub-header").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 300));

  const updatePresentation = await window.evaluate(() => {
    const banner = document.querySelector(".auto-update-sub-header");
    const action = banner?.querySelector("a, button");
    const icon = banner?.querySelector("svg");
    const bannerRect = banner?.getBoundingClientRect();
    const actionRect = action?.getBoundingClientRect();
    return {
      text: banner?.textContent?.replace(/\s+/g, " ").trim(),
      bannerWidth: bannerRect?.width ?? 0,
      actionWidth: actionRect?.width ?? 0,
      iconColor: icon ? getComputedStyle(icon).color : null,
    };
  });

  if (
    updatePresentation.bannerWidth < 600 ||
    Math.abs(updatePresentation.bannerWidth - updatePresentation.actionWidth) >
      1
  ) {
    throw new Error(
      `Update indicator is not an integrated full-width row: ${JSON.stringify(updatePresentation)}`
    );
  }

  const updatePath = path.join(outputDirectory, "update-available-desktop.png");
  await window.screenshot({ path: updatePath });
  console.log(`captured ${updatePath}`);
  console.log(`update presentation: ${JSON.stringify(updatePresentation)}`);

  if (pageErrors.length > 0) {
    throw new Error(`Renderer errors: ${pageErrors.join(" | ")}`);
  }
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !/Failed to load resource.*external-resources/i.test(message) &&
      !/net::ERR_(?:NAME_NOT_RESOLVED|CONNECTION_REFUSED)/i.test(message)
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
