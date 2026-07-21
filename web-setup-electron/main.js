const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
} = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { exec, execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

const REPO = "Kewz4/GameHub2026";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const WINDOW_WIDTH = 560;
const WINDOW_HEIGHT = 420;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    resizable: false,
    maximizable: false,
    frame: true,
    title: "GameHub Setup",
    backgroundColor: "#0d0d0d",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("index.html");
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "GameHub-WebSetup",
          ...headers,
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          httpsGet(res.headers.location, headers).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(res);
      }
    );
    req.on("error", reject);
  });
}

async function httpsGetJSON(url) {
  const res = await httpsGet(url, { Accept: "application/json" });
  let data = "";
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

async function downloadFile(url, destPath, onProgress) {
  const res = await httpsGet(url);
  const total = parseInt(res.headers["content-length"] || "0", 10);
  let downloaded = 0;

  const writeStream = fs.createWriteStream(destPath);

  for await (const chunk of res) {
    writeStream.write(chunk);
    downloaded += chunk.length;
    if (onProgress) {
      onProgress({
        downloaded,
        total,
        percent: total > 0 ? (downloaded / total) * 100 : 0,
      });
    }
  }

  await new Promise((resolve, reject) => {
    writeStream.end(resolve);
    writeStream.on("error", reject);
  });
}

async function getLatestRelease() {
  const release = await httpsGetJSON(API_URL);
  return {
    tag: release.tag_name,
    assets: (release.assets || []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
    })),
  };
}

function findAsset(assets, pattern, exclude) {
  const regex = new RegExp(pattern, "i");
  const excludeRegex = exclude ? new RegExp(exclude, "i") : null;
  return assets.find(
    (a) => regex.test(a.name) && (!excludeRegex || !excludeRegex.test(a.name))
  );
}

async function extractZip(zipPath, destDir) {
  const psScript = `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`;
  await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`
  );
}

async function createWindowsShortcut(targetPath, workingDir, shortcutName) {
  const script = `(New-Object -ComObject WScript.Shell).CreateShortcut("${shortcutName}").TargetPath = "${targetPath.replace(/\\/g, "\\\\")}"`;
  const desktop = await execAsync(
    `powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`
  );
  const desktopPath = desktop.stdout.trim();
  const shortcutPath = path.join(desktopPath, "GameHub Portable.lnk");

  const fullScript = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${shortcutPath}'); $s.TargetPath = '${targetPath}'; $s.WorkingDirectory = '${workingDir}'; $s.Save()`;
  await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${fullScript.replace(/"/g, '\\"')}"`
  );
  return shortcutPath;
}

async function performInstall(event, release) {
  const tmpDir = os.tmpdir();
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
    await shell.openPath(installerPath);
    event.reply("setup:done", { mode: "install" });
  } else if (platform === "linux") {
    const debAsset = findAsset(release.assets, "\\.deb$");
    const rpmAsset = findAsset(release.assets, "\\.rpm$");
    const appImageAsset = findAsset(release.assets, "\\.appimage$");

    if (debAsset) {
      const debPath = path.join(tmpDir, debAsset.name);
      event.reply("setup:status", `Downloading ${debAsset.name}...`);
      await downloadFile(debAsset.url, debPath, (progress) => {
        event.reply("setup:progress", progress);
      });
      event.reply("setup:status", "Installing (needs sudo)...");
      await execAsync(`sudo apt-get install -y "${debPath}"`);
      event.reply("setup:done", { mode: "install" });
    } else if (rpmAsset) {
      const rpmPath = path.join(tmpDir, rpmAsset.name);
      event.reply("setup:status", `Downloading ${rpmAsset.name}...`);
      await downloadFile(rpmAsset.url, rpmPath, (progress) => {
        event.reply("setup:progress", progress);
      });
      event.reply("setup:status", "Installing (needs sudo)...");
      await execAsync(`sudo dnf install -y "${rpmPath}"`);
      event.reply("setup:done", { mode: "install" });
    } else if (appImageAsset) {
      const appPath = path.join(
        os.homedir(),
        ".local",
        "share",
        "GameHub",
        "GameHub.AppImage"
      );
      const binDir = path.join(os.homedir(), ".local", "bin");
      fs.mkdirSync(path.dirname(appPath), { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(
        path.join(os.homedir(), ".local", "share", "applications"),
        { recursive: true }
      );

      event.reply("setup:status", `Downloading ${appImageAsset.name}...`);
      await downloadFile(appImageAsset.url, appPath, (progress) => {
        event.reply("setup:progress", progress);
      });
      fs.chmodSync(appPath, 0o755);

      const symlinkPath = path.join(binDir, "gamehub");
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      fs.symlinkSync(appPath, symlinkPath);

      const desktopEntry = `[Desktop Entry]
Name=GameHub
Exec=${appPath} %U
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/hydralauncher;`;
      fs.writeFileSync(
        path.join(os.homedir(), ".local", "share", "applications", "gamehub.desktop"),
        desktopEntry
      );

      event.reply("setup:done", { mode: "install" });
    } else {
      throw new Error("No Linux package found in release " + release.tag);
    }
  }
}

async function performPortable(event, release, targetDir) {
  const tmpDir = os.tmpdir();
  const platform = process.platform;

  if (platform === "win32") {
    const asset = findAsset(release.assets, "\\.zip$", "blockmap");
    if (!asset)
      throw new Error("No portable zip found in release " + release.tag);

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
    if (fs.existsSync(exePath)) {
      try {
        await createWindowsShortcut(exePath, targetDir);
        event.reply("setup:status", "Desktop shortcut created.");
      } catch {}
    }

    try {
      fs.unlinkSync(zipPath);
    } catch {}

    event.reply("setup:done", { mode: "portable", path: targetDir });
  } else if (platform === "linux") {
    const asset = findAsset(release.assets, "\\.appimage$");
    if (!asset)
      throw new Error("No AppImage found in release " + release.tag);

    const appPath = path.join(targetDir, "GameHub.AppImage");
    fs.mkdirSync(targetDir, { recursive: true });

    event.reply("setup:status", `Downloading ${asset.name}...`);
    await downloadFile(asset.url, appPath, (progress) => {
      event.reply("setup:progress", progress);
    });
    fs.chmodSync(appPath, 0o755);

    const markerPath = path.join(targetDir, "portable");
    fs.writeFileSync(markerPath, "");

    event.reply("setup:done", { mode: "portable", path: targetDir });
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

  ipcMain.on("setup:install", async (event, release) => {
    try {
      await performInstall(event, release);
    } catch (error) {
      event.reply("setup:error", error.message);
    }
  });

  ipcMain.on("setup:portable", async (event, release, targetDir) => {
    try {
      await performPortable(event, release, targetDir);
    } catch (error) {
      event.reply("setup:error", error.message);
    }
  });

  ipcMain.on("setup:launch", (_event, targetPath) => {
    if (targetPath && fs.existsSync(targetPath)) {
      shell.openPath(targetPath);
    }
    app.quit();
  });

  ipcMain.on("setup:quit", () => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
