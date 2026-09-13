/* global globalThis */

/**
 * Guarded, opt-in launch proof for one real emulated game.
 *
 * The profile, emulator installation, and ROM are cloned into OS temp before
 * GameHub starts. The source database, emulator state, and ROM are hashed
 * before/after and are never written. The runner launches through the real
 * openClassicsGame IPC and closes through the real closeGame IPC.
 *
 * Required environment:
 *   PLAYWRIGHT_PACKAGE=<directory containing Playwright's index.mjs>
 *   GAMEHUB_LIVE_DATA=<populated portable GameHub data directory>
 *   GAMEHUB_QA_LIVE_EMULATOR_ACK=I_UNDERSTAND_THIS_LAUNCHES_AN_EMULATED_GAME
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  findMainWindow,
  hashDirectory,
  listWindowsProcesses,
  makeChildEnvironment,
  prepareClone,
  sameProcessIdentity,
  waitFor,
} from "./qa-live-overlay-acceptance.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_LAUNCHES_AN_EMULATED_GAME";
const CLONE_PREFIX = "gamehub-live-emulator-qa-";
const TARGET = Object.freeze({
  id: "ocarina-of-time-3d",
  title: "The Legend of Zelda - Ocarina of Time 3D",
  shop: "launchbox",
  objectId: "local-n3ds-228e2f92cd0941e4",
  system: "n3ds",
  emulatorBinary: "azahar",
  emulatorProcessName: "azahar.exe",
  romExtension: ".3ds",
});

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function isPathWithin(candidatePath, parentPath) {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath)
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function assertGuardedClonePath(cloneRoot) {
  ensure(
    isPathWithin(cloneRoot, os.tmpdir()),
    "Refusing cleanup because the emulator clone is outside OS temp."
  );
  ensure(
    path.basename(cloneRoot).startsWith(CLONE_PREFIX),
    "Refusing cleanup because the emulator clone has an unexpected prefix."
  );
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return hash.digest("hex");
}

async function findNamedFile(directory, expectedName) {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findNamedFile(absolute, expectedName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.toLowerCase() === expectedName) {
      return absolute;
    }
  }
  return null;
}

async function readCloneTarget(databasePath) {
  const { ClassicLevel } = await import("classic-level");
  const database = new ClassicLevel(databasePath, { valueEncoding: "json" });
  const games = database.sublevel("games", { valueEncoding: "json" });
  const emulators = database.sublevel("emulators", {
    valueEncoding: "json",
  });
  try {
    await database.open();
    const game = await games.get(`${TARGET.shop}:${TARGET.objectId}`);
    const emulator = await emulators.get(TARGET.system);
    return { game, emulator };
  } finally {
    await database.close().catch(() => undefined);
  }
}

async function patchCloneTarget({
  databasePath,
  cloneEmulatorExecutable,
  cloneRomPath,
}) {
  const { ClassicLevel } = await import("classic-level");
  const database = new ClassicLevel(databasePath, { valueEncoding: "json" });
  const games = database.sublevel("games", { valueEncoding: "json" });
  const emulators = database.sublevel("emulators", {
    valueEncoding: "json",
  });
  const automaticSync = database.sublevel(
    "cloud-save-automatic-sync-settings",
    { valueEncoding: "json" }
  );
  const gameKey = `${TARGET.shop}:${TARGET.objectId}`;
  try {
    await database.open();
    const game = await games.get(gameKey);
    const emulator = await emulators.get(TARGET.system);
    ensure(game && !game.isDeleted, "The cloned emulator game is unavailable.");
    ensure(
      emulator?.binary === TARGET.emulatorBinary,
      "The cloned 3DS configuration is not Azahar."
    );
    const disc = {
      ...(game.discs?.[0] ?? {}),
      path: cloneRomPath,
      label: path.basename(cloneRomPath),
      fileName: path.basename(cloneRomPath),
    };
    await games.put(gameKey, {
      ...game,
      executablePath: null,
      discs: [disc],
      selectedDiscPath: cloneRomPath,
      automaticCloudSync: false,
    });
    await automaticSync.put(gameKey, false);
    await emulators.put(TARGET.system, {
      ...emulator,
      executablePath: cloneEmulatorExecutable,
      romFolders: [
        {
          ...(emulator.romFolders?.[0] ?? { id: "qa-cloned-roms" }),
          path: path.dirname(cloneRomPath),
          scanSubfolders: false,
          fileCount: 1,
          sizeBytes: fs.statSync(cloneRomPath).size,
          lastScanAt: null,
        },
      ],
    });
  } finally {
    await database.close().catch(() => undefined);
  }
}

function readWindowIdentity(pid) {
  const script = `$process = Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue
if ($null -eq $process) { return }
[PSCustomObject]@{
  ProcessId = $process.Id
  MainWindowHandle = [string]$process.MainWindowHandle
  MainWindowTitle = [string]$process.MainWindowTitle
} | ConvertTo-Json -Compress`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    }
  );
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function captureForegroundWindow(targetIdentity, destination) {
  ensure(
    targetIdentity?.pid > 4 &&
      /^\d+$/u.test(targetIdentity.creationDate ?? "") &&
      targetIdentity.name === TARGET.emulatorProcessName &&
      path.basename(targetIdentity.executablePath ?? "").toLowerCase() ===
        TARGET.emulatorProcessName,
    "An exact Azahar process identity is required for native capture."
  );
  const encodedDestination = Buffer.from(destination, "utf8").toString(
    "base64"
  );
  const encodedExpectedPath = Buffer.from(
    path.resolve(targetIdentity.executablePath),
    "utf8"
  ).toString("base64");
  const script = `Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameHubWindowCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
}
'@
$expectedPath = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedExpectedPath}'))
$expectedCreationDate = '${targetIdentity.creationDate}'
$process = Get-Process -Id ${String(targetIdentity.pid)} -ErrorAction Stop
$currentPath = ''
$currentCreationDate = ''
try { $currentPath = [System.IO.Path]::GetFullPath([string]$process.Path) } catch { throw 'The emulator executable path is unavailable.' }
try { $currentCreationDate = $process.StartTime.ToFileTimeUtc().ToString() } catch { throw 'The emulator creation time is unavailable.' }
if (-not [string]::Equals($currentPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'The emulator executable identity changed.' }
if ($currentCreationDate -ne $expectedCreationDate) { throw 'The emulator creation identity changed.' }
$handle = $process.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'The emulator has no main window.' }
[void][GameHubWindowCapture]::ShowWindowAsync($handle, 9)
$madeTopmost = $true
try {
  [void][GameHubWindowCapture]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x0043)
  [void][GameHubWindowCapture]::BringWindowToTop($handle)
  [void][GameHubWindowCapture]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 1000
  $rect = New-Object GameHubWindowCapture+RECT
  if (-not [GameHubWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed.' }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 0 -or $height -le 0) { throw 'The emulator window has invalid dimensions.' }
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $destination = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedDestination}'))
    $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
  [PSCustomObject]@{ Width = $width; Height = $height } | ConvertTo-Json -Compress
} finally {
  if ($madeTopmost) {
    [void][GameHubWindowCapture]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0043)
  }
}
`;
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedScript,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    }
  );
  ensure(
    result.status === 0,
    `Native Azahar capture failed: ${String(result.stderr ?? "").trim()}`
  );
  ensure(
    fs.existsSync(destination) && fs.statSync(destination).size > 0,
    "Native Azahar screenshot was not written."
  );
  const { default: sharp } = await import("sharp");
  const stats = await sharp(destination).stats();
  ensure(
    stats.channels.some((channel) => channel.stdev > 1),
    "Native Azahar screenshot contained no visible detail."
  );
  let dimensions = null;
  try {
    dimensions = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    dimensions = null;
  }
  return {
    method: "windows-foreground-window",
    name: "Azahar foreground window",
    size: {
      width: Number(dimensions?.Width ?? 0),
      height: Number(dimensions?.Height ?? 0),
    },
    file: path.basename(destination),
  };
}

async function captureEmulatorWindow(
  electronApp,
  destination,
  targetIdentity,
  cloneRoot
) {
  const currentProcess = listWindowsProcesses().find(
    (item) => item.pid === targetIdentity.pid
  );
  ensure(
    sameProcessIdentity(targetIdentity, currentProcess) &&
      currentProcess.name === TARGET.emulatorProcessName &&
      isPathWithin(currentProcess.executablePath, cloneRoot),
    "The exact cloned Azahar identity changed before screenshot capture."
  );
  const capture = await electronApp.evaluate(async ({ desktopCapturer }) => {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => {
      const name = candidate.name.toLowerCase();
      return name.includes("azahar") || name.includes("ocarina of time");
    });
    if (!source || source.thumbnail.isEmpty()) return null;
    return {
      name: source.name,
      size: source.thumbnail.getSize(),
      png: source.thumbnail.toPNG().toString("base64"),
    };
  });
  if (capture?.png) {
    await fs.promises.writeFile(
      destination,
      Buffer.from(capture.png, "base64")
    );
    ensure(
      fs.statSync(destination).size > 0,
      "Azahar screenshot was not written."
    );
    return {
      method: "electron-desktop-capturer",
      name: capture.name,
      size: capture.size,
      file: path.basename(destination),
    };
  }
  return captureForegroundWindow(targetIdentity, destination);
}

function isWindowsSessionLocked() {
  return listWindowsProcesses().some((item) => item.name === "logonui.exe");
}

function terminateExactCloneProcess(processItem, cloneRoot) {
  if (
    !processItem ||
    processItem.pid <= 4 ||
    processItem.name !== TARGET.emulatorProcessName ||
    !processItem.executablePath ||
    path.basename(processItem.executablePath).toLowerCase() !==
      TARGET.emulatorProcessName ||
    !isPathWithin(processItem.executablePath, cloneRoot)
  ) {
    throw new Error("Refusing unsafe emulator-process cleanup.");
  }

  const readCurrentProcess = () =>
    listWindowsProcesses().find((item) => item.pid === processItem.pid) ?? null;
  const requireExactCurrentProcess = () => {
    const currentProcess = readCurrentProcess();
    if (!currentProcess) return null;
    ensure(
      sameProcessIdentity(processItem, currentProcess) &&
        currentProcess.name === TARGET.emulatorProcessName &&
        path.basename(currentProcess.executablePath).toLowerCase() ===
          TARGET.emulatorProcessName &&
        isPathWithin(currentProcess.executablePath, cloneRoot),
      "Refusing emulator cleanup because the PID identity changed."
    );
    return currentProcess;
  };

  const currentProcess = requireExactCurrentProcess();
  if (!currentProcess) return;
  try {
    process.kill(currentProcess.pid);
    return;
  } catch {
    const fallbackProcess = requireExactCurrentProcess();
    if (!fallbackProcess) return;
    const result = spawnSync(
      "taskkill.exe",
      ["/F", "/PID", String(fallbackProcess.pid)],
      { windowsHide: true, encoding: "utf8", timeout: 15_000 }
    );
    if (result.status !== 0) {
      throw new Error("The cloned Azahar process could not be cleaned up.");
    }
  }
}

function sanitizeError(error) {
  return String(error instanceof Error ? (error.stack ?? error.message) : error)
    .replace(/(?:file:\/\/\/)?[a-z]:[\\/][^\r\n"'`<>|]*/giu, "[absolute-path]")
    .slice(0, 6_000);
}

async function main() {
  ensure(process.platform === "win32", "Live emulator QA is Windows-only.");
  ensure(
    process.env.GAMEHUB_QA_LIVE_EMULATOR_ACK === ACKNOWLEDGEMENT,
    "Refusing to launch an emulated game without the exact acknowledgement."
  );
  const sourceData = process.env.GAMEHUB_LIVE_DATA?.trim();
  const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE?.trim();
  ensure(
    sourceData && path.isAbsolute(sourceData),
    "GAMEHUB_LIVE_DATA must be absolute."
  );
  ensure(
    playwrightPackage && path.isAbsolute(playwrightPackage),
    "PLAYWRIGHT_PACKAGE must be absolute."
  );

  const electronExecutable = path.join(
    ROOT,
    "node_modules",
    "electron",
    "dist",
    "electron.exe"
  );
  const databaseSource = path.join(sourceData, "gamehub-db");
  const sourceEmulatorRoot = path.join(sourceData, "emulators", "azahar");
  const sourceEmulatorExecutable = await findNamedFile(
    sourceEmulatorRoot,
    TARGET.emulatorProcessName
  );
  ensure(sourceEmulatorExecutable, "The live Azahar executable is missing.");

  const baselineProcesses = listWindowsProcesses();
  const baselinePids = new Set(baselineProcesses.map((item) => item.pid));
  ensure(
    !baselineProcesses.some(
      (item) =>
        item.name === "gamehub.exe" ||
        item.name === "electron.exe" ||
        item.name === TARGET.emulatorProcessName
    ),
    "Close GameHub, current-repo Electron, and Azahar before emulator QA."
  );

  const runId = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "");
  const artifactRoot = path.join(
    ROOT,
    "artifacts",
    "qa-live-emulator-launch",
    runId
  );
  const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), CLONE_PREFIX));
  const cloneData = path.join(cloneRoot, "data");
  const cloneDatabase = path.join(cloneData, "gamehub-db");
  const report = {
    schemaVersion: 1,
    kind: "gamehub-live-emulator-launch-proof",
    runId,
    startedAt: new Date().toISOString(),
    target: {
      id: TARGET.id,
      title: TARGET.title,
      shop: TARGET.shop,
      objectId: TARGET.objectId,
      system: TARGET.system,
      emulator: TARGET.emulatorBinary,
    },
    safety: {
      isolatedClone: true,
      credentialsStripped: false,
      cloudSavesDisabled: false,
      sourceDatabaseUnchanged: false,
      sourceEmulatorUnchanged: false,
      sourceRomUnchanged: false,
    },
    launch: null,
    screenshot: null,
    cleanup: {
      emulatorProcessesRemaining: null,
      electronProcessesRemaining: null,
      electronStopped: false,
      cloneRemoved: false,
    },
    error: null,
    finishedAt: null,
    outcome: "running",
  };

  let electronApp = null;
  let page = null;
  let targetProcess = null;
  let sourceRomPath = null;
  let sourceHashes = null;
  let cloneAzaharLog = null;
  let cloneAzaharLogBefore = null;

  try {
    await fs.promises.mkdir(artifactRoot, { recursive: true });
    const databaseHash = await hashDirectory(databaseSource);
    const emulatorHash = await hashDirectory(sourceEmulatorRoot);
    const clonePreparation = await prepareClone(sourceData, cloneData);
    report.safety.credentialsStripped = clonePreparation.credentialsStripped;
    report.safety.cloudSavesDisabled = true;

    const clonedTarget = await readCloneTarget(cloneDatabase);
    ensure(
      clonedTarget.game?.title === TARGET.title &&
        clonedTarget.emulator?.binary === TARGET.emulatorBinary,
      "The populated clone does not match the expected 3DS target."
    );
    sourceRomPath =
      clonedTarget.game.selectedDiscPath ?? clonedTarget.game.discs?.[0]?.path;
    ensure(
      sourceRomPath &&
        path.extname(sourceRomPath).toLowerCase() === TARGET.romExtension &&
        fs.existsSync(sourceRomPath) &&
        fs.statSync(sourceRomPath).isFile(),
      "The configured Ocarina of Time 3D ROM is missing."
    );
    const romHash = await hashFile(sourceRomPath);
    sourceHashes = { databaseHash, emulatorHash, romHash };

    const cloneEmulatorRoot = path.join(cloneData, "emulators", "azahar");
    await fs.promises.mkdir(path.dirname(cloneEmulatorRoot), {
      recursive: true,
    });
    await fs.promises.cp(sourceEmulatorRoot, cloneEmulatorRoot, {
      recursive: true,
    });
    const cloneEmulatorExecutable = path.join(
      cloneEmulatorRoot,
      path.relative(sourceEmulatorRoot, sourceEmulatorExecutable)
    );
    cloneAzaharLog = await findNamedFile(cloneEmulatorRoot, "azahar_log.txt");
    ensure(cloneAzaharLog, "The cloned Azahar runtime log is missing.");
    cloneAzaharLogBefore = await hashFile(cloneAzaharLog);
    const cloneRomDirectory = path.join(cloneRoot, "roms");
    await fs.promises.mkdir(cloneRomDirectory, { recursive: true });
    const cloneRomPath = path.join(
      cloneRomDirectory,
      `ocarina-of-time-3d${TARGET.romExtension}`
    );
    await fs.promises.copyFile(sourceRomPath, cloneRomPath);
    await patchCloneTarget({
      databasePath: cloneDatabase,
      cloneEmulatorExecutable,
      cloneRomPath,
    });

    const { _electron: electron } = await import(
      pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
    );
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [ROOT, "--force-device-scale-factor=1", "--high-dpi-support=1"],
      cwd: ROOT,
      timeout: 60_000,
      env: makeChildEnvironment(cloneRoot),
    });
    page = await findMainWindow(electronApp);
    const libraryTarget = await page.evaluate(
      async ({ shop, objectId }) => {
        const library = await globalThis.window.electron.getLibrary();
        const game = library.find(
          (candidate) =>
            candidate.shop === shop &&
            candidate.objectId === objectId &&
            !candidate.isDeleted
        );
        return game
          ? { title: game.title, shop: game.shop, objectId: game.objectId }
          : null;
      },
      { shop: TARGET.shop, objectId: TARGET.objectId }
    );
    ensure(
      libraryTarget?.title === TARGET.title,
      "The target is absent from the launched clone."
    );

    const launchStartedAt = Date.now();
    await page.evaluate(
      ({ shop, objectId, discPath }) =>
        globalThis.window.electron.openClassicsGame(
          shop,
          objectId,
          discPath,
          false
        ),
      { shop: TARGET.shop, objectId: TARGET.objectId, discPath: cloneRomPath }
    );
    targetProcess = await waitFor(
      "Cloned Azahar process",
      () =>
        listWindowsProcesses().find(
          (item) =>
            !baselinePids.has(item.pid) &&
            item.name === TARGET.emulatorProcessName &&
            item.executablePath &&
            path.resolve(item.executablePath).toLowerCase() ===
              path.resolve(cloneEmulatorExecutable).toLowerCase()
        ) ?? null,
      Boolean,
      60_000,
      250
    );
    const targetWindow = await waitFor(
      "Azahar game window",
      () => readWindowIdentity(targetProcess.pid),
      (identity) =>
        Number(identity?.MainWindowHandle ?? 0) > 0 &&
        String(identity?.MainWindowTitle ?? "").trim().length > 0,
      60_000,
      250
    );
    report.launch = {
      throughGameHubIpc: true,
      processDetected: true,
      windowDetected: true,
      romArgumentDetected: targetProcess.commandLine
        .toLowerCase()
        .includes(cloneRomPath.toLowerCase()),
      pid: targetProcess.pid,
      executable: path.basename(targetProcess.executablePath),
      executableInsideClone: isPathWithin(
        targetProcess.executablePath,
        cloneRoot
      ),
      windowTitle: targetWindow.MainWindowTitle,
      readyInMilliseconds: Date.now() - launchStartedAt,
    };
    ensure(
      report.launch.executableInsideClone,
      "Azahar launched outside the clone."
    );
    ensure(
      report.launch.romArgumentDetected,
      "Azahar launched without the cloned Ocarina ROM argument."
    );

    await sleep(5_000);
    const runtimeLogContents = await fs.promises.readFile(
      cloneAzaharLog,
      "utf8"
    );
    const runtimeLogChanged =
      (await hashFile(cloneAzaharLog)) !== cloneAzaharLogBefore;
    const runtimeEvidence = {
      logChangedDuringLaunch: runtimeLogChanged,
      bootGameDetected: runtimeLogContents.includes("GMainWindow::BootGame"),
      ocarinaProgramIdDetected: runtimeLogContents.includes(
        "Program ID: 0004000000033600"
      ),
      rendererStarted:
        runtimeLogContents.includes("GL_RENDERER:") ||
        runtimeLogContents.includes("Renderer_VulkanDevice:"),
      audioStarted: runtimeLogContents.includes("Audio Stream Started"),
    };
    ensure(
      Object.values(runtimeEvidence).every(Boolean),
      "Azahar started but current-run logs did not prove Ocarina emulation."
    );
    report.launch.runtimeEvidence = runtimeEvidence;
    if (isWindowsSessionLocked()) {
      report.screenshot = {
        captured: false,
        status: "blocked-by-locked-windows-session",
        evidence: "current-run-emulator-renderer-and-audio-log",
      };
    } else {
      const screenshotPath = path.join(
        artifactRoot,
        "ocarina-of-time-3d-azahar.png"
      );
      report.screenshot = {
        captured: true,
        ...(await captureEmulatorWindow(
          electronApp,
          screenshotPath,
          targetProcess,
          cloneRoot
        )),
      };
    }
    const closeRequested = await page.evaluate(
      ({ shop, objectId }) =>
        globalThis.window.electron.closeGame(shop, objectId),
      { shop: TARGET.shop, objectId: TARGET.objectId }
    );
    ensure(closeRequested === true, "GameHub did not accept emulator cleanup.");
    await waitFor(
      "Azahar cleanup through GameHub",
      () =>
        listWindowsProcesses().filter(
          (item) =>
            !baselinePids.has(item.pid) &&
            item.name === TARGET.emulatorProcessName
        ),
      (items) => items.length === 0,
      20_000,
      250
    );
    targetProcess = null;
    report.outcome = "launch-observed";
  } catch (error) {
    report.outcome = "failed";
    report.error = sanitizeError(error);
  } finally {
    if (targetProcess) {
      try {
        terminateExactCloneProcess(targetProcess, cloneRoot);
        await sleep(750);
      } catch (error) {
        report.outcome = "failed";
        report.error ??= sanitizeError(error);
      }
    }
    if (electronApp) {
      await electronApp.close().catch(() => undefined);
      let remainingElectronProcesses;
      try {
        remainingElectronProcesses = await waitFor(
          "QA Electron cleanup",
          () =>
            listWindowsProcesses().filter(
              (item) =>
                !baselinePids.has(item.pid) && item.name === "electron.exe"
            ),
          (items) => items.length === 0,
          10_000,
          250
        );
      } catch {
        remainingElectronProcesses = listWindowsProcesses().filter(
          (item) => !baselinePids.has(item.pid) && item.name === "electron.exe"
        );
      }
      report.cleanup.electronProcessesRemaining =
        remainingElectronProcesses.length;
      report.cleanup.electronStopped = remainingElectronProcesses.length === 0;
      if (!report.cleanup.electronStopped) {
        report.outcome = "failed";
        report.error ??= "A QA Electron process remained after cleanup.";
      }
    } else {
      report.cleanup.electronProcessesRemaining = 0;
      report.cleanup.electronStopped = true;
    }
    report.cleanup.emulatorProcessesRemaining = listWindowsProcesses().filter(
      (item) =>
        !baselinePids.has(item.pid) && item.name === TARGET.emulatorProcessName
    ).length;
    if (report.cleanup.emulatorProcessesRemaining !== 0) {
      report.outcome = "failed";
      report.error ??= "A cloned Azahar process remained after cleanup.";
    }

    if (sourceHashes) {
      try {
        report.safety.sourceDatabaseUnchanged =
          sourceHashes.databaseHash === (await hashDirectory(databaseSource));
        report.safety.sourceEmulatorUnchanged =
          sourceHashes.emulatorHash ===
          (await hashDirectory(sourceEmulatorRoot));
        report.safety.sourceRomUnchanged =
          sourceHashes.romHash === (await hashFile(sourceRomPath));
      } catch (error) {
        report.outcome = "failed";
        report.error ??= sanitizeError(error);
      }
      if (
        !report.safety.sourceDatabaseUnchanged ||
        !report.safety.sourceEmulatorUnchanged ||
        !report.safety.sourceRomUnchanged
      ) {
        report.outcome = "failed";
        report.error ??= "A live emulator source changed during QA.";
      }
    }

    try {
      assertGuardedClonePath(cloneRoot);
      await fs.promises.rm(cloneRoot, { recursive: true, force: true });
      report.cleanup.cloneRemoved = !fs.existsSync(cloneRoot);
    } catch (error) {
      report.outcome = "failed";
      report.error ??= sanitizeError(error);
    }
    report.finishedAt = new Date().toISOString();
    await fs.promises.mkdir(artifactRoot, { recursive: true });
    await fs.promises.writeFile(
      path.join(artifactRoot, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.outcome !== "launch-observed") process.exitCode = 1;
}

await main();
