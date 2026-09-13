const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { downloadReleaseAsset } = require("./download.js");
const {
  getLinuxInstallPaths,
  resolveLinuxPackageManager,
  getLinuxPackageCommand,
  installLinuxAppImage,
  findLinuxAsset,
  launchLinuxAppImage,
} = require("./linux-install.js");

const execFileAsync = promisify(execFile);

const REPO = "Kewz4/GameHub2026";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET_API_PATH_PREFIX = `/repos/${REPO}/releases/assets/`;
// The release repo is public, so the releases feed and asset downloads both
// resolve anonymously. Earlier builds embedded a read-only PAT here; that
// shipped a credential inside a publicly downloadable installer.
const WINDOW_WIDTH = 820;
const WINDOW_HEIGHT = 540;
const MAX_HTTPS_REDIRECTS = 5;

let mainWindow = null;
let verifiedRelease = null;
let operationInProgress = false;
let completedExecutable = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    resizable: false,
    maximizable: false,
    frame: true,
    title: "GameHub Setup",
    backgroundColor: "#121212",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function httpsGet(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const requestHeaders = {
      "User-Agent": "GameHub-WebSetup",
      ...headers,
    };

    // Public downloads must not forward credentials to a redirect destination.
    delete requestHeaders.Authorization;
    delete requestHeaders.authorization;
    if (
      parsedUrl.protocol === "https:" &&
      parsedUrl.hostname === "api.github.com"
    ) {
      requestHeaders["X-GitHub-Api-Version"] = "2022-11-28";
    }

    const req = https.get(
      parsedUrl,
      {
        headers: requestHeaders,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirectCount >= MAX_HTTPS_REDIRECTS) {
            reject(new Error("Too many redirects while downloading GameHub."));
            return;
          }
          const redirectUrl = new URL(
            res.headers.location,
            parsedUrl
          ).toString();
          httpsGet(redirectUrl, headers, redirectCount + 1).then(
            resolve,
            reject
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(res);
      }
    );
    req.on("error", reject);
    req.setTimeout(30_000, () =>
      req.destroy(new Error("The download connection timed out. Try again."))
    );
  });
}

async function httpsGetJSON(url) {
  const res = await httpsGet(url, {
    Accept: "application/vnd.github+json",
  });
  let data = "";
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

async function downloadFile(url, destPath, onProgress) {
  const assetUrl = new URL(url);
  if (
    assetUrl.protocol !== "https:" ||
    assetUrl.hostname !== "api.github.com" ||
    !assetUrl.pathname.startsWith(ASSET_API_PATH_PREFIX)
  ) {
    throw new Error("GameHub refused an untrusted release asset URL.");
  }

  const asset = verifiedRelease?.assets.find((entry) => entry.url === url);
  if (!asset) throw new Error("Refresh the release before downloading.");
  return downloadReleaseAsset(
    asset,
    destPath,
    (assetUrl) => httpsGet(assetUrl, { Accept: "application/octet-stream" }),
    onProgress
  );
}

async function getLatestRelease() {
  const release = await httpsGetJSON(API_URL);
  verifiedRelease = {
    tag: release.tag_name,
    assets: (release.assets || []).map((a) => ({
      name: a.name,
      url: a.url,
      size: a.size,
      digest: a.digest,
    })),
  };
  return verifiedRelease;
}

function findAsset(assets, pattern, exclude) {
  const regex = new RegExp(pattern, "i");
  const excludeRegex = exclude ? new RegExp(exclude, "i") : null;
  return assets.find(
    (a) => regex.test(a.name) && (!excludeRegex || !excludeRegex.test(a.name))
  );
}

async function extractZip(zipPath, destDir) {
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const script = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destDir)}`;
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true }
  );
}

async function createWindowsShortcut(targetPath, workingDir, shortcutName) {
  const desktopPath = app.getPath("desktop");
  const shortcutPath = path.join(desktopPath, "GameHub Portable.lnk");
  if (
    !shell.writeShortcutLink(shortcutPath, "create", {
      target: targetPath,
      cwd: workingDir,
      description: "GameHub Portable",
      icon: targetPath,
      iconIndex: 0,
    })
  )
    throw new Error("The desktop shortcut could not be created.");
  return shortcutPath;
}

async function performInstall(event, release) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-setup-"));
  const platform = process.platform;

  if (platform === "win32") {
    const asset = findAsset(release.assets, "setup.*\\.exe$", "web");
    if (!asset) throw new Error("No installer found in release " + release.tag);

    const installerPath = path.join(tmpDir, asset.name);
    event.reply("setup:status", `Downloading ${asset.name}...`);

    await downloadFile(asset.url, installerPath, (progress) => {
      event.reply("setup:progress", progress);
    });

    event.reply("setup:status", "Launching installer...");
    const error = await shell.openPath(installerPath);
    if (error) throw new Error(`The installer could not open: ${error}`);
    event.reply("setup:done", { mode: "install", handedOff: true });
  } else if (platform === "linux") {
    let distribution = "";
    try {
      distribution = fs.readFileSync("/etc/os-release", "utf8");
    } catch {}
    const manager = resolveLinuxPackageManager({ release: distribution });
    const packageAsset =
      manager === "apt"
        ? findLinuxAsset(release.assets, "deb")
        : ["dnf", "zypper"].includes(manager)
          ? findLinuxAsset(release.assets, "rpm")
          : null;
    const packagePath = packageAsset
      ? path.join(tmpDir, packageAsset.name)
      : null;
    const plan = packagePath
      ? getLinuxPackageCommand(manager, packagePath)
      : null;
    if (plan) {
      event.reply("setup:status", `Downloading ${packageAsset.name}...`);
      await downloadFile(packageAsset.url, packagePath, (progress) =>
        event.reply("setup:progress", progress)
      );
      event.reply(
        "setup:status",
        "Approve the desktop permission prompt to install GameHub."
      );
      try {
        await execFileAsync(plan.command, plan.args, {
          timeout: 600_000,
          maxBuffer: 4 * 1024 * 1024,
        });
      } catch {
        throw new Error(
          "Linux package installation was cancelled or failed. Retry, or choose Portable to install without administrator access."
        );
      }
      event.reply("setup:done", { mode: "install" });
    } else {
      const asset = findLinuxAsset(release.assets, "appimage");
      if (!asset)
        throw new Error(
          "No compatible Linux package found in release " + release.tag
        );
      event.reply("setup:status", `Downloading ${asset.name}...`);
      const result = await installLinuxAppImage({
        directory: getLinuxInstallPaths().directory,
        iconSource: path.join(__dirname, "assets", "icon.png"),
        download: (destination) =>
          downloadFile(asset.url, destination, (progress) =>
            event.reply("setup:progress", progress)
          ),
      });
      completedExecutable = result.executable;
      await execFileAsync("update-desktop-database", [
        getLinuxInstallPaths().applications,
      ]).catch(() => {});
      event.reply("setup:done", {
        mode: "install",
        path: result.directory,
        executable: result.executable,
        desktopEntryCreated: result.desktopEntryCreated,
        warnings: result.warnings,
      });
    }
  }
}

async function performPortable(event, release, targetDir) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-setup-"));
  const platform = process.platform;

  if (platform === "win32") {
    const asset = findAsset(release.assets, "\\.zip$", "blockmap");
    if (!asset)
      throw new Error("No portable zip found in release " + release.tag);

    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
      throw new Error(
        "Choose an empty folder for GameHub Portable so existing files stay safe."
      );
    }
    const zipPath = path.join(tmpDir, asset.name);
    event.reply("setup:status", `Downloading ${asset.name}...`);

    await downloadFile(asset.url, zipPath, (progress) => {
      event.reply("setup:progress", progress);
    });

    event.reply("setup:status", `Extracting to ${targetDir}...`);
    fs.mkdirSync(targetDir, { recursive: true });
    await extractZip(zipPath, targetDir);

    const markerPath = path.join(targetDir, "portable");
    fs.writeFileSync(markerPath, "");

    const exePath = path.join(targetDir, "GameHub.exe");
    if (!fs.existsSync(exePath))
      throw new Error("The portable download did not contain GameHub.exe.");
    if (fs.existsSync(exePath)) {
      try {
        await createWindowsShortcut(exePath, targetDir);
        event.reply("setup:status", "Desktop shortcut created.");
      } catch {}
    }

    try {
      fs.unlinkSync(zipPath);
    } catch {}

    completedExecutable = exePath;
    event.reply("setup:done", {
      mode: "portable",
      path: targetDir,
      executable: exePath,
    });
  } else if (platform === "linux") {
    const asset = findLinuxAsset(release.assets, "appimage");
    if (!asset) throw new Error("No AppImage found in release " + release.tag);
    event.reply("setup:status", `Downloading ${asset.name}...`);
    const result = await installLinuxAppImage({
      directory: targetDir,
      portable: true,
      download: (destination) =>
        downloadFile(asset.url, destination, (progress) =>
          event.reply("setup:progress", progress)
        ),
    });
    completedExecutable = result.executable;
    event.reply("setup:done", {
      mode: "portable",
      path: targetDir,
      executable: result.executable,
    });
  }
}

async function selectFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: path.join(os.homedir(), "GameHub"),
  });
  return result.canceled ? null : result.filePaths[0];
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("setup:get-release", async () => {
    try {
      return await getLatestRelease();
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle("setup:select-folder", async () => {
    return await selectFolder();
  });

  ipcMain.on("setup:install", async (event) => {
    if (operationInProgress) return;
    operationInProgress = true;
    try {
      if (!verifiedRelease)
        throw new Error("Load a release before installing.");
      await performInstall(event, verifiedRelease);
    } catch (error) {
      event.reply("setup:error", error.message);
    } finally {
      operationInProgress = false;
    }
  });

  ipcMain.on("setup:portable", async (event, _release, targetDir) => {
    if (operationInProgress) return;
    operationInProgress = true;
    try {
      if (!verifiedRelease)
        throw new Error("Load a release before installing.");
      await performPortable(event, verifiedRelease, targetDir);
    } catch (error) {
      event.reply("setup:error", error.message);
    } finally {
      operationInProgress = false;
    }
  });

  ipcMain.on("setup:launch", async (event, targetPath) => {
    if (
      operationInProgress ||
      !completedExecutable ||
      targetPath !== completedExecutable
    )
      return;
    operationInProgress = true;
    try {
      if (process.platform === "linux")
        await launchLinuxAppImage(completedExecutable);
      else {
        const error = await shell.openPath(completedExecutable);
        if (error) throw new Error(error);
      }
      app.quit();
    } catch (error) {
      event.reply("setup:error", error.message);
    } finally {
      operationInProgress = false;
    }
  });

  ipcMain.on("setup:quit", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
