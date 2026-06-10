import { app, BrowserWindow, globalShortcut, net, protocol } from "electron";
import updater from "electron-updater";
import i18n from "i18next";
import path from "node:path";
import fs from "node:fs";
import url from "node:url";

// Ensure app name matches productName so electron-updater uses
// "GameHub-updater" instead of "hydralauncher-updater" for its temp dir.
app.setName("GameHub");

// Detect portable mode: electron-builder NSIS portable sets PORTABLE_EXECUTABLE_DIR;
// our custom installer writes a "portable" marker file next to the exe.
// Also redirect on first run (no .gamehub-setup marker) so Roaming is never
// touched until the user explicitly chooses "Install" in the setup window.
const SETUP_MARKER_FILE = ".gamehub-setup";
const _portableExeDir =
  process.env.PORTABLE_EXECUTABLE_DIR ||
  (() => {
    try {
      const exeDir = path.dirname(process.execPath);
      if (fs.existsSync(path.join(exeDir, "portable"))) return exeDir;
      if (
        process.platform === "win32" &&
        app.isPackaged &&
        !fs.existsSync(path.join(exeDir, SETUP_MARKER_FILE))
      ) {
        // NSIS auto-update wipes the marker. If data already exists at the
        // default Electron userData path (Roaming/GameHub), restore the marker
        // and keep using the normal userData path so Epic/GOG sessions survive.
        const defaultData = path.join(process.env.APPDATA ?? "", "GameHub");
        const hasExistingData =
          fs.existsSync(path.join(defaultData, "LOCK")) ||
          fs.existsSync(path.join(defaultData, "level-db")) ||
          fs.existsSync(path.join(defaultData, "legendary-config"));
        if (hasExistingData) {
          try {
            fs.writeFileSync(path.join(exeDir, SETUP_MARKER_FILE), "", "utf8");
          } catch {
            // ignore
          }
          return null;
        }
        return exeDir;
      }
    } catch {
      // ignore
    }
    return null;
  })();

if (_portableExeDir) {
  const dataDir = path.join(_portableExeDir, "data");
  app.setPath("userData", dataDir);
  app.setPath("logs", path.join(dataDir, "logs"));
  app.setPath("sessionData", path.join(dataDir, "session"));
  app.setPath("crashDumps", path.join(dataDir, "crashes"));
  if (process.platform === "win32") {
    app.setPath("appData", dataDir);
  }
}
import { electronApp, optimizer } from "@electron-toolkit/utils";
import {
  logger,
  clearGamesPlaytime,
  WindowManager,
  Lock,
  PowerSaveBlockerManager,
} from "@main/services";
import resources from "@locales";
import { PythonRPC } from "./services/python-rpc";
import { db, gamesSublevel, levelKeys } from "./level";
import { GameShop, UserPreferences } from "@types";
import { launchGame } from "./helpers";
import { loadState } from "./main";
import { UpdateCheckerManager } from "./services/update-checker-manager";

const { autoUpdater } = updater;

autoUpdater.setFeedURL({
  provider: "github",
  owner: "Kewz4",
  repo: "hydra",
});

autoUpdater.logger = logger;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

if (process.platform !== "linux") {
  app.commandLine.appendSwitch("--no-sandbox");
}

i18n.init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// Must be registered before app ready: lets the renderer fetch() local: URLs
// (e.g. profile image crop reads files as blobs) without tainting canvases.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local",
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

const PROTOCOL = "hydralauncher";

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  electronApp.setAppUserModelId("io.gamehub.launcher");

  protocol.handle("local", (request) => {
    const filePath = request.url.slice("local:".length);
    return net.fetch(url.pathToFileURL(decodeURI(filePath)).toString());
  });

  protocol.handle("gradient", (request) => {
    const gradientCss = decodeURIComponent(
      request.url.slice("gradient:".length)
    );

    // Parse gradient CSS safely without regex to prevent ReDoS
    let direction = "45deg";
    let color1 = "#4a90e2";
    let color2 = "#7b68ee";

    // Simple string parsing approach - more secure than regex
    if (
      gradientCss.startsWith("linear-gradient(") &&
      gradientCss.endsWith(")")
    ) {
      const content = gradientCss.slice(16, -1); // Remove "linear-gradient(" and ")"
      const parts = content.split(",").map((part) => part.trim());

      if (parts.length >= 3) {
        direction = parts[0];
        color1 = parts[1];
        color2 = parts[2];
      }
    }

    let x1 = "0%",
      y1 = "0%",
      x2 = "100%",
      y2 = "100%";

    if (direction === "to right") {
      y2 = "0%";
    } else if (direction === "to bottom") {
      x2 = "0%";
    } else if (direction === "45deg") {
      y1 = "100%";
      y2 = "0%";
    } else if (direction === "225deg") {
      x1 = "100%";
      x2 = "0%";
    } else if (direction === "315deg") {
      x1 = "100%";
      y1 = "100%";
      x2 = "0%";
      y2 = "0%";
    }
    // Note: "135deg" case removed as it uses all default values

    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <defs>
          <linearGradient id="grad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
            <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
      </svg>
    `;

    return new Response(svgContent, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  });

  await loadState();

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .catch(() => "en");

  if (language) i18n.changeLanguage(language);

  const deepLinkArg = process.argv.find((arg) =>
    arg.startsWith("hydralauncher://")
  );
  const isRunDeepLink = deepLinkArg?.startsWith("hydralauncher://run");

  const { needsSetup } = await import("./services/installer");

  // Ctrl+Shift+L / Cmd+Shift+L toggles the debug console window
  globalShortcut.register("CommandOrControl+Shift+L", () => {
    WindowManager.toggleConsoleWindow();
  });

  // Wire update checker events to the update checker window
  UpdateCheckerManager.setSendEvent((event) => {
    WindowManager.updateCheckerWindow?.webContents.send(
      "updateCheckerEvent",
      event
    );
  });

  // Show the update checker on every launch; it signals "proceed" when done
  WindowManager.createUpdateCheckerWindow();
  UpdateCheckerManager.checkAndUpdate().catch(() => {});

  // When the update checker window closes (no update / error / user skipped),
  // open the normal app flow
  const proceedToApp = () => {
    if (needsSetup()) {
      WindowManager.createInstallerWindow();
    } else if (!process.argv.includes("--hidden") && !isRunDeepLink) {
      WindowManager.createMainWindow();
    }
    WindowManager.createNotificationWindow();
    WindowManager.createSystemTray(language || "en");
    if (deepLinkArg) handleDeepLinkPath(deepLinkArg);
  };

  // The update checker window closing is the signal to proceed.
  // The renderer calls updateCheckerProceed() IPC which closes it.
  WindowManager.updateCheckerWindow?.once("closed", () => {
    proceedToApp();
  });
});

app.on("browser-window-created", (_, window) => {
  optimizer.watchWindowShortcuts(window);
});

const handleRunGame = async (shop: GameShop, objectId: string) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game?.executablePath) {
    logger.error("Game not found or no executable path", { shop, objectId });
    return;
  }

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  // Only open main window if setting is disabled
  if (!userPreferences?.hideToTrayOnGameStart) {
    WindowManager.createMainWindow();
  }

  await launchGame({
    shop,
    objectId,
    executablePath: game.executablePath,
    launchOptions: game.launchOptions,
  });
};

const handleDeepLinkPath = (uri?: string) => {
  if (!uri) return;

  try {
    const url = new URL(uri);

    if (url.host === "run") {
      const shop = url.searchParams.get("shop") as GameShop | null;
      const objectId = url.searchParams.get("objectId");

      if (shop && objectId) {
        handleRunGame(shop, objectId);
      }

      return;
    }

    if (url.host === "install-source") {
      WindowManager.redirect(`settings${url.search}`);
      return;
    }

    if (url.host === "profile") {
      const userId = url.searchParams.get("userId");

      if (userId) {
        WindowManager.redirect(`profile/${userId}`);
      }

      return;
    }

    if (url.host === "install-theme") {
      const themeName = url.searchParams.get("theme");
      const authorId = url.searchParams.get("authorId");
      const authorName = url.searchParams.get("authorName");

      if (themeName && authorId && authorName) {
        WindowManager.redirect(
          `settings?theme=${themeName}&authorId=${authorId}&authorName=${authorName}`
        );
      }
    }

    if (url.host === "game") {
      const shop = url.searchParams.get("shop");
      const objectId = url.searchParams.get("objectId");
      const title = url.searchParams.get("title") ?? "";
      if (shop && objectId) {
        WindowManager.redirect(
          `game/${shop}/${objectId}?title=${encodeURIComponent(title)}&openRepacks=1&sharedLink=1`
        );
      }
    }
  } catch (error) {
    logger.error("Error handling deep link", uri, error);
  }
};

app.on("second-instance", (_event, commandLine) => {
  const deepLink = commandLine.find((arg) =>
    arg.startsWith("hydralauncher://")
  );

  // Check if this is a "run" deep link - don't show main window in that case
  const isRunDeepLink = deepLink?.startsWith("hydralauncher://run");

  if (!isRunDeepLink) {
    if (WindowManager.mainWindow) {
      if (WindowManager.mainWindow.isMinimized())
        WindowManager.mainWindow.restore();

      WindowManager.mainWindow.focus();
    } else {
      WindowManager.createMainWindow();
    }
  }

  handleDeepLinkPath(deepLink);
});

app.on("open-url", (_event, url) => {
  handleDeepLinkPath(url);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  WindowManager.mainWindow = null;
});

let canAppBeClosed = false;

app.on("before-quit", async (e) => {
  await Lock.releaseLock();

  if (!canAppBeClosed) {
    e.preventDefault();
    PowerSaveBlockerManager.reset();
    /* Disconnects Python RPC */
    PythonRPC.kill();
    await clearGamesPlaytime();
    canAppBeClosed = true;
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createMainWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
