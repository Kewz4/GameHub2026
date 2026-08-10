/* global globalThis */

/**
 * Proof-grade, opt-in live gameplay-recorder acceptance runner.
 *
 * This script is intentionally dormant unless the caller supplies the exact
 * acknowledgement below. It launches a real game, so do not add it to a normal
 * test/build script.
 *
 * Required environment:
 *   PLAYWRIGHT_PACKAGE
 *     Directory containing Playwright's index.mjs.
 *   GAMEHUB_LIVE_DATA
 *     Populated GameHub data directory. It is copied before Electron starts.
 *   GAMEHUB_QA_LIVE_RECORDER_ACK=I_UNDERSTAND_THIS_LAUNCHES_A_GAME
 *
 * Optional environment:
 *   GAMEHUB_QA_INCLUDE_KHAZAN=true
 *   GAMEHUB_QA_HADES_EXE=<absolute Hades2.exe path>
 *   GAMEHUB_QA_HADES_OBJECT_ID=<exact cloned-library object id>
 *   GAMEHUB_QA_HADES_SHOP=<exact cloned-library shop>
 *   GAMEHUB_QA_KHAZAN_EXE=<absolute steamclient_loader_x64.exe path>
 *   GAMEHUB_QA_KHAZAN_TRACKING_EXE=<absolute BBQ-Win64-Shipping.exe path>
 *   GAMEHUB_QA_KHAZAN_OBJECT_ID=<exact cloned-library object id>
 *   GAMEHUB_QA_KHAZAN_SHOP=<exact cloned-library shop>
 *   GAMEHUB_QA_GAME_READY_TIMEOUT_MS=180000
 *   GAMEHUB_QA_ELEVATED_CLEANUP_SIGNAL=<guarded OS-temp handshake path>
 *
 * Safety properties:
 *   - Refuses to run while another GameHub instance is detected.
 *   - Copies the populated profile to a guarded OS-temporary portable root.
 *   - Sets GAMEHUB_READ_ONLY_VISUAL_QA=true in the child process.
 *   - Asserts that the opened LevelDB is the temporary clone.
 *   - Disables and verifies V2 automatic Cloud Saves for every cloned game.
 *   - Writes recorder preferences directly to cloned LevelDB. This deliberately
 *     avoids updateUserPreferences, whose production behavior includes an R2
 *     settings-backup request.
 *   - Never calls a Hydra/R2 write API and never copies the clone back.
 *   - Refuses to kill any process that existed before the target launch.
 *   - Emits only token/path-sanitized JSON under artifacts/.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LIVE_ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_LAUNCHES_A_GAME";
const CLONE_PREFIX = "gamehub-live-recorder-qa-";
const REQUIRED_SOURCE_DIRECTORIES = [
  "gamehub-db",
  "r2-image-cache",
  "Assets",
  "ludusavi",
];
const RECORDER_CONFIGURATION = Object.freeze({
  resolution: "1080p",
  fps: 60,
  qualityPreset: "quality",
  replayDurationSeconds: 30,
  captureGameAudio: true,
});
const NATIVE_BACKEND = "native_ffmpeg_nvenc";
const EXPECTED_MINIMUM_TARGET_BITRATE = 50_000_000;
const TARGET_SPECS = Object.freeze([
  {
    id: "hades-ii",
    titlePatterns: [/^hades\s*(?:ii|2)$/iu, /hades\s*(?:ii|2)/iu],
    executableEnvironment: "GAMEHUB_QA_HADES_EXE",
    objectIdEnvironment: "GAMEHUB_QA_HADES_OBJECT_ID",
    shopEnvironment: "GAMEHUB_QA_HADES_SHOP",
    executableCandidates: [
      "C:\\Games\\Hades II\\Ship\\Hades2.exe",
      "C:\\Games\\Hades II\\Release\\Hades2.exe",
    ],
    trackingCandidates: [
      "C:\\Games\\Hades II\\Ship\\Hades2.exe",
      "C:\\Games\\Hades II\\Release\\Hades2.exe",
    ],
    processNames: ["hades2.exe"],
    rootCandidates: ["C:\\Games\\Hades II"],
  },
  {
    id: "khazan",
    optional: true,
    titlePatterns: [/khazan/iu, /first\s+berserker/iu],
    executableEnvironment: "GAMEHUB_QA_KHAZAN_EXE",
    trackingEnvironment: "GAMEHUB_QA_KHAZAN_TRACKING_EXE",
    objectIdEnvironment: "GAMEHUB_QA_KHAZAN_OBJECT_ID",
    shopEnvironment: "GAMEHUB_QA_KHAZAN_SHOP",
    executableCandidates: [
      "C:\\Games\\The First Berserker Khazan\\steamclient_loader_x64.exe",
    ],
    trackingCandidates: [
      "C:\\Games\\The First Berserker Khazan\\BBQ\\Binaries\\Win64\\BBQ-Win64-Shipping.exe",
    ],
    processNames: ["steamclient_loader_x64.exe", "bbq-win64-shipping.exe"],
    rootCandidates: ["C:\\Games\\The First Berserker Khazan"],
  },
]);

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

function normalizeTitle(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

function numericEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  ensure(
    Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum,
    `${name} must be between ${minimum} and ${maximum}.`
  );
  return Math.round(parsed);
}

function resolveElevatedCleanupSignal() {
  const raw = process.env.GAMEHUB_QA_ELEVATED_CLEANUP_SIGNAL?.trim();
  if (!raw) return null;

  ensure(
    path.isAbsolute(raw),
    "GAMEHUB_QA_ELEVATED_CLEANUP_SIGNAL must be an absolute path."
  );
  const resolved = path.resolve(raw);
  const resolvedParent = fs.realpathSync.native(path.dirname(resolved));
  const resolvedTemporaryRoot = fs.realpathSync.native(os.tmpdir());
  ensure(
    isPathWithin(resolvedParent, resolvedTemporaryRoot),
    "The elevated cleanup handshake must stay inside the OS temp directory."
  );
  ensure(
    path.basename(resolved).startsWith("gamehub-recorder-qa-cleanup-"),
    "The elevated cleanup handshake has an unexpected file name."
  );
  return resolved;
}

function createSanitizer(context) {
  const sensitivePaths = new Set();
  const addPath = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    sensitivePaths.add(resolved);
    sensitivePaths.add(resolved.replaceAll("\\", "/"));
  };
  addPath(context.repositoryRoot);
  addPath(context.sourceData);
  addPath(context.isolatedPortableRoot);
  addPath(context.artifactRoot);

  const sanitizeText = (value) => {
    let text = String(value ?? "");
    text = text.replace(/Bearer\s+[^\s"']+/giu, "Bearer [redacted]");
    text = text.replace(
      /([?&](?:access_?token|refresh_?token|api_?key|client_?secret|token|key|secret|password|code)=)[^&\s]+/giu,
      "$1[redacted]"
    );
    text = text.replace(
      /("(?:access_?token|refresh_?token|api_?key|client_?secret|token|key|secret|password|code)"\s*:\s*")[^"]+/giu,
      "$1[redacted]"
    );
    text = text.replace(/https?:\/\/[^\s"'`\\)]+/giu, "[url]");
    text = text.replace(
      /(?:file:\/\/\/)?[a-z]:[\\/]Users[\\/][^\\/\s]+/giu,
      "[user-home]"
    );
    for (const sensitivePath of [...sensitivePaths].sort(
      (left, right) => right.length - left.length
    )) {
      text = text.replaceAll(sensitivePath, "[path]");
    }
    // Diagnostics can originate outside this harness. Redact any remaining
    // Windows absolute path even if it was not one of the paths registered
    // above. Greedily losing the rest of a line is safer than leaking it.
    text = text.replace(
      /(?:file:\/\/\/)?[a-z]:[\\/][^\r\n"'`<>|]*/giu,
      "[absolute-path]"
    );
    return text.slice(0, 4_000);
  };

  const sanitizeValue = (value) => {
    if (typeof value === "string") return sanitizeText(value);
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)])
      );
    }
    return value;
  };

  return { addPath, sanitizeText, sanitizeValue };
}

async function hashFile(filePath, hash) {
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
}

async function hashDirectory(directory) {
  const hash = crypto.createHash("sha256");
  const visit = async (current, relativeRoot = "") => {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = path.join(relativeRoot, entry.name);
      hash.update(relative.split(path.sep).join("/"));
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) await hashFile(absolute, hash);
    }
  };
  await visit(directory);
  return hash.digest("hex");
}

function assertGuardedClonePath(isolatedPortableRoot) {
  const resolved = path.resolve(isolatedPortableRoot);
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  ensure(
    resolved.toLowerCase().startsWith(temporaryRoot),
    "Refusing cleanup because the clone is outside the OS temporary directory."
  );
  ensure(
    path.basename(resolved).startsWith(CLONE_PREFIX),
    "Refusing cleanup because the clone does not have the recorder-QA prefix."
  );
}

function listWindowsProcesses() {
  const script = [
    "$ErrorActionPreference = 'Stop';",
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  ensure(result.status === 0, "Could not enumerate Windows processes for QA.");
  const parsed = JSON.parse(result.stdout || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    pid: Number(item.ProcessId) || 0,
    parentPid: Number(item.ParentProcessId) || 0,
    name: String(item.Name ?? "").toLowerCase(),
    executablePath: String(item.ExecutablePath ?? ""),
    commandLine: String(item.CommandLine ?? ""),
  }));
}

function isNativeRecorderProcess(processItem) {
  return (
    processItem.name === "ffmpeg.exe" &&
    /(?:gfxcapture=hwnd=|native-\d{8}-\d{8}\.mp4)/iu.test(
      processItem.commandLine
    )
  );
}

function targetProcessMatcher(target) {
  const names = new Set(target.processNames.map((name) => name.toLowerCase()));
  const roots = target.processRoots.map(
    (root) => `${path.resolve(root).toLowerCase()}${path.sep}`
  );
  return (processItem) => {
    if (names.has(processItem.name)) return true;
    const executable = processItem.executablePath
      ? path.resolve(processItem.executablePath).toLowerCase()
      : "";
    return roots.some((root) => executable.startsWith(root));
  };
}

function findConflictingGameHubProcesses(processes, repositoryRoot) {
  const normalizedRepository = path.resolve(repositoryRoot).toLowerCase();
  return processes.filter(
    (item) =>
      item.name === "gamehub.exe" ||
      (item.name === "electron.exe" &&
        item.commandLine.toLowerCase().includes(normalizedRepository))
  );
}

function terminateNewProcessTree(pid, baselinePids) {
  if (!pid || baselinePids.has(pid)) return false;
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  if (result.status === 0) return true;

  const fallback = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Stop-Process -Id ${String(pid)} -Force -ErrorAction Stop`,
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  return fallback.status === 0;
}

const WINDOWS_RECORDER_QA_CONTROL_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
public static class GameHubRecorderQaWindow {
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr window);
}`;

function controlWindowsProcessWindow(pid, action) {
  ensure(Number.isSafeInteger(pid) && pid > 0, "Invalid game process id.");
  ensure(
    action === "minimize" || action === "restore",
    "Invalid game-window control action."
  );
  const operation =
    action === "minimize"
      ? "if (-not [GameHubRecorderQaWindow]::PostMessage($window, 0x0112, [IntPtr]0xF020, [IntPtr]::Zero)) { exit 4 }"
      : "[void][GameHubRecorderQaWindow]::PostMessage($window, 0x0112, [IntPtr]0xF120, [IntPtr]::Zero); [void][GameHubRecorderQaWindow]::ShowWindowAsync($window, 9); Start-Sleep -Milliseconds 150; [void][GameHubRecorderQaWindow]::SetForegroundWindow($window)";
  const script = `$ErrorActionPreference = 'Stop'
$source = @'
${WINDOWS_RECORDER_QA_CONTROL_SOURCE}
'@
Add-Type -TypeDefinition $source
$process = Get-Process -Id ${String(pid)} -ErrorAction Stop
$window = $process.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { exit 3 }
${operation}`;
  const startedAt = Date.now();
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  ensure(result.status === 0, `Windows could not ${action} the game window.`);
  return startedAt;
}

async function waitFor(
  description,
  readValue,
  predicate,
  timeoutMs,
  intervalMs = 400
) {
  const startedAt = Date.now();
  let lastValue;
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await readValue();
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`${description} timed out after ${timeoutMs} ms.${detail}`);
}

async function prepareIsolatedClone(context) {
  for (const directory of REQUIRED_SOURCE_DIRECTORIES) {
    const source = path.join(context.sourceData, directory);
    ensure(
      fs.existsSync(source),
      `The populated data source is missing required directory ${directory}.`
    );
  }
  await fs.promises.mkdir(context.isolatedData, { recursive: true });
  await fs.promises.mkdir(path.join(context.isolatedData, "session"), {
    recursive: true,
  });
  await fs.promises.mkdir(context.clipRoot, { recursive: true });
  for (const directory of REQUIRED_SOURCE_DIRECTORIES) {
    await fs.promises.cp(
      path.join(context.sourceData, directory),
      path.join(context.isolatedData, directory),
      { recursive: true }
    );
  }
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  await hashFile(filePath, hash);
  return hash.digest("hex");
}

async function stagePreviewDependency(context, directoryName, requiredFile) {
  const sourceDirectory = path.join(context.repositoryRoot, directoryName);
  const targetDirectory = path.join(
    path.dirname(context.mainEntry),
    directoryName
  );
  const sourceRequired = path.join(sourceDirectory, requiredFile);
  const targetRequired = path.join(targetDirectory, requiredFile);
  ensure(
    fs.existsSync(sourceRequired),
    `Missing preview dependency ${directoryName}.`
  );
  if (fs.existsSync(targetDirectory)) {
    ensure(
      fs.existsSync(targetRequired),
      `The existing out/main/${directoryName} preview dependency is incomplete.`
    );
    ensure(
      (await sha256(sourceRequired)) === (await sha256(targetRequired)),
      `The existing out/main/${directoryName} preview dependency is stale.`
    );
    return false;
  }
  await fs.promises.cp(sourceDirectory, targetDirectory, { recursive: true });
  context.stagedPreviewDirectories.push(targetDirectory);
  return true;
}

async function removeStagedPreviewDependencies(context) {
  const outMain = path.resolve(path.dirname(context.mainEntry));
  for (const directory of context.stagedPreviewDirectories.reverse()) {
    const resolved = path.resolve(directory);
    ensure(
      path.dirname(resolved) === outMain,
      "Refusing to remove a preview dependency outside out/main."
    );
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
}

async function findMainWindow(electronApp) {
  await electronApp.firstWindow({ timeout: 40_000 });
  let updateCheckerProceeded = false;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    await sleep(250);
    const mainWindow = electronApp.windows().find((candidate) => {
      try {
        const candidateUrl = new URL(candidate.url());
        return (
          candidateUrl.pathname.endsWith("/out/renderer/index.html") &&
          !candidateUrl.hash.includes("update-checker") &&
          !candidateUrl.hash.includes("achievement-notification") &&
          !candidateUrl.hash.includes("overlay") &&
          !candidateUrl.hash.includes("game-recorder-capture") &&
          !candidateUrl.hash.includes("game-launcher")
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
  throw new Error("The isolated GameHub main window did not open.");
}

/**
 * Reach the already-loaded main-process QA control without importing the entry
 * bundle twice. It only exists in an unpackaged, explicitly read-only QA run.
 */
async function mainControl(electronApp, mainModuleUrl, action, payload = {}) {
  return electronApp.evaluate(
    async ({ BrowserWindow }, request) => {
      const windowsBefore = BrowserWindow.getAllWindows().length;
      const control = globalThis.__gameHubRecorderQaControl;
      const windowsAfter = BrowserWindow.getAllWindows().length;
      const {
        levelKeys,
        database,
        gamesSublevel,
        OverlayManager,
        GameRecorderManager,
        NativeAddon,
        getCloudSaveAutomaticSyncEnabled,
      } = control ?? {};
      const requireCore = () => {
        if (
          !levelKeys ||
          !database ||
          !gamesSublevel ||
          !OverlayManager ||
          !GameRecorderManager ||
          !NativeAddon ||
          !getCloudSaveAutomaticSyncEnabled
        ) {
          throw new Error(
            "The read-only main process did not expose recorder QA controls."
          );
        }
      };

      if (request.action === "inspect") {
        requireCore();
        return {
          windowsBefore,
          windowsAfter,
          databaseLocation: database.location,
          readOnlyVisualQa: process.env.GAMEHUB_READ_ONLY_VISUAL_QA === "true",
        };
      }

      requireCore();
      if (request.action === "patch-preferences") {
        const current = await database
          .get(levelKeys.userPreferences, { valueEncoding: "json" })
          .catch(() => ({}));
        const next = { ...current, ...request.payload.patch };
        await database.put(levelKeys.userPreferences, next, {
          valueEncoding: "json",
        });
        OverlayManager.applyUserPreferences(next);
        return {
          databaseLocation: database.location,
          recorder: {
            enabled: next.gameRecorderEnabled,
            resolution: next.gameRecorderResolution,
            fps: next.gameRecorderFps,
            qualityPreset: next.gameRecorderQualityPreset,
            instantReplayEnabled: next.gameRecorderInstantReplayEnabled,
            replayDurationSeconds: next.gameRecorderReplayDurationSeconds,
            captureAudio: next.gameRecorderCaptureAudio,
            outputDirectory: next.gameRecorderOutputDirectory,
            musicProvider: next.musicProvider,
          },
        };
      }

      if (request.action === "verify-cloud-sync-disabled") {
        let enabledCount = 0;
        for (const game of request.payload.games) {
          if (
            await getCloudSaveAutomaticSyncEnabled(game.objectId, game.shop)
          ) {
            enabledCount += 1;
          }
        }
        return { checked: request.payload.games.length, enabledCount };
      }

      if (request.action === "prepare-target-game") {
        const key = levelKeys.game(
          request.payload.game.shop,
          request.payload.game.objectId
        );
        const current = await gamesSublevel.get(key);
        if (!current)
          throw new Error("The selected game is absent from the clone.");
        const next = {
          ...current,
          executablePath: request.payload.game.executablePath,
          trackingExecutablePaths: request.payload.game.trackingExecutablePaths,
        };
        await gamesSublevel.put(key, next);
        return { databaseLocation: database.location, prepared: true };
      }

      if (request.action === "set-active-game") {
        // Await the recorder first, then take the production OverlayManager path.
        // OverlayManager's duplicate recorder call is then an idempotent no-op.
        await GameRecorderManager.setActiveGame(request.payload.game);
        OverlayManager.setActiveGame(request.payload.game);
        return true;
      }

      if (request.action === "clear-active-game") {
        await GameRecorderManager.clearActiveGame(request.payload.game);
        OverlayManager.clearActiveGame(request.payload.game);
        return true;
      }

      if (request.action === "recorder-diagnostics") {
        const segments = Array.isArray(GameRecorderManager.segments)
          ? GameRecorderManager.segments
          : null;
        const targetPid =
          OverlayManager.getTargetProcessId() ||
          GameRecorderManager.targetPid ||
          0;
        return {
          state: GameRecorderManager.getState(),
          targetPid,
          processAccess:
            targetPid > 0
              ? NativeAddon.getProcessAccessStatus(targetPid)
              : { canInject: false, errorCode: 0 },
          foregroundPid: NativeAddon.getForegroundProcessId(),
          completedSegmentCount: segments?.length ?? null,
          newestSegmentEndedAt: segments?.at(-1)?.endedAt ?? null,
          nativeSessionActive: Boolean(GameRecorderManager.nativeSession),
          segmentDirectoryActive: Boolean(GameRecorderManager.segmentDirectory),
          segmentDirectoryPath: GameRecorderManager.segmentDirectory ?? null,
        };
      }

      if (request.action === "focus-target") {
        const targetPid =
          OverlayManager.getTargetProcessId() ||
          GameRecorderManager.targetPid ||
          0;
        return {
          targetPid,
          focused: targetPid > 0 && NativeAddon.focusProcessWindow(targetPid),
        };
      }

      if (request.action === "focus-main-window") {
        const mainWindow = BrowserWindow.getAllWindows().find((candidate) => {
          const url = candidate.webContents.getURL();
          return (
            url.includes("/out/renderer/index.html") &&
            !url.includes("update-checker") &&
            !url.includes("game-recorder-capture") &&
            !url.includes("game-launcher") &&
            !url.includes("overlay")
          );
        });
        if (!mainWindow || mainWindow.isDestroyed()) {
          throw new Error(
            "The main GameHub window is unavailable for Alt+Tab QA."
          );
        }
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.setFocusable(true);
        mainWindow.setAlwaysOnTop(true, "screen-saver");
        mainWindow.moveTop();
        mainWindow.focus();
        const handle = mainWindow.getNativeWindowHandle();
        const hwnd =
          handle.length >= 8
            ? Number(handle.readBigUInt64LE(0))
            : handle.readUInt32LE(0);
        const forced = hwnd > 0 && NativeAddon.forceForegroundWindow(hwnd);
        const foregroundPid = NativeAddon.getForegroundProcessId();
        mainWindow.setAlwaysOnTop(false);
        return {
          forced,
          mainProcessPid: process.pid,
          foregroundPid,
          focusedAt: foregroundPid === process.pid ? Date.now() : null,
          targetPid:
            OverlayManager.getTargetProcessId() ||
            GameRecorderManager.targetPid ||
            0,
        };
      }

      throw new Error(`Unknown recorder QA main action: ${request.action}`);
    },
    { mainModuleUrl, action, payload }
  );
}

async function disableAllCloudSync(page, library) {
  const games = library
    .filter((game) => game?.objectId && game?.shop && !game.isDeleted)
    .map((game) => ({ objectId: game.objectId, shop: game.shop }));
  const batchSize = 8;
  for (let index = 0; index < games.length; index += batchSize) {
    const batch = games.slice(index, index + batchSize);
    const results = await page.evaluate(async (items) => {
      return Promise.all(
        items.map((game) =>
          globalThis.window.electron.setCloudSaveAutomaticSyncEnabled(
            game.objectId,
            game.shop,
            false
          )
        )
      );
    }, batch);
    ensure(
      results.every((enabled) => enabled === false),
      "A cloned Cloud Saves V2 automatic-sync write did not resolve false."
    );
  }
  return games;
}

function chooseLibraryGame(library, spec) {
  const requestedObjectId = process.env[spec.objectIdEnvironment]?.trim();
  const requestedShop = process.env[spec.shopEnvironment]?.trim();
  const candidates = library.filter((game) => {
    if (!game || game.isDeleted) return false;
    if (requestedObjectId && game.objectId !== requestedObjectId) return false;
    if (requestedShop && game.shop !== requestedShop) return false;
    if (requestedObjectId) return true;
    const title = normalizeTitle(game.title);
    return spec.titlePatterns.some((pattern) => pattern.test(title));
  });
  ensure(candidates.length > 0, `No cloned-library entry matched ${spec.id}.`);
  candidates.sort((left, right) => {
    const leftInstalled =
      left.isInstalledLocally || left.executablePath ? 1 : 0;
    const rightInstalled =
      right.isInstalledLocally || right.executablePath ? 1 : 0;
    return rightInstalled - leftInstalled;
  });
  return candidates[0];
}

function firstExistingFile(candidates) {
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function resolveTarget(library, spec, sanitizer) {
  const game = chooseLibraryGame(library, spec);
  const explicitExecutable = process.env[spec.executableEnvironment]?.trim();
  const executableCandidates = [
    explicitExecutable,
    game.executablePath,
    game.nativeExecutablePath,
    ...spec.executableCandidates,
  ].filter(Boolean);
  const executablePath = firstExistingFile(executableCandidates);
  ensure(executablePath, `No installed executable was found for ${spec.id}.`);
  ensure(
    path.isAbsolute(executablePath),
    `${spec.id} executable must be absolute.`
  );

  const explicitTracking = spec.trackingEnvironment
    ? process.env[spec.trackingEnvironment]?.trim()
    : null;
  const trackingExecutablePaths = [
    ...(game.trackingExecutablePaths ?? []),
    explicitTracking,
    ...spec.trackingCandidates,
  ]
    .filter(Boolean)
    .filter((candidate) => fs.existsSync(candidate));
  const processRoots = [
    ...spec.rootCandidates.filter((candidate) => fs.existsSync(candidate)),
    path.dirname(executablePath),
    ...trackingExecutablePaths.map((candidate) => path.dirname(candidate)),
  ];
  for (const targetPath of [
    executablePath,
    ...trackingExecutablePaths,
    ...processRoots,
  ]) {
    sanitizer.addPath(targetPath);
  }
  return {
    id: spec.id,
    game: {
      ...game,
      executablePath,
      trackingExecutablePaths: [...new Set(trackingExecutablePaths)],
    },
    executablePath,
    trackingExecutablePaths: [...new Set(trackingExecutablePaths)],
    processNames: [
      ...new Set([
        ...spec.processNames,
        path.basename(executablePath).toLowerCase(),
        ...trackingExecutablePaths.map((candidate) =>
          path.basename(candidate).toLowerCase()
        ),
      ]),
    ],
    processRoots: [
      ...new Set(processRoots.map((candidate) => path.resolve(candidate))),
    ],
  };
}

function assertRecorderConfiguration(state, outputDirectory) {
  const configuration = state.configuration;
  ensure(configuration.enabled === true, "Recorder is not enabled.");
  ensure(
    configuration.resolution === RECORDER_CONFIGURATION.resolution,
    "Recorder did not resolve to 1080p."
  );
  ensure(
    configuration.fps === RECORDER_CONFIGURATION.fps,
    "Recorder is not 60 fps."
  );
  ensure(
    configuration.qualityPreset === RECORDER_CONFIGURATION.qualityPreset,
    "Recorder is not using the quality preset."
  );
  ensure(
    configuration.instantReplayEnabled === true,
    "Instant Replay is disabled."
  );
  ensure(
    configuration.replayDurationSeconds ===
      RECORDER_CONFIGURATION.replayDurationSeconds,
    "Instant Replay is not configured for 30 seconds."
  );
  ensure(
    configuration.captureGameAudio === true,
    "System audio is not enabled."
  );
  ensure(
    path.resolve(state.resolvedOutputDirectory) ===
      path.resolve(outputDirectory),
    "Recorder output escaped the QA artifact folder."
  );
}

function assertNativeCompletedState(diagnostics) {
  const state = diagnostics.state;
  ensure(state.captureActive === true, "The gameplay capture is not active.");
  ensure(
    state.activeCaptureBackend === NATIVE_BACKEND,
    `Expected ${NATIVE_BACKEND}, received ${state.activeCaptureBackend ?? "none"}.`
  );
  ensure(
    state.captureDiagnostics?.backend === NATIVE_BACKEND,
    "No completed native NVENC segment has been committed."
  );
  ensure(
    state.captureDiagnostics.encoderName === "h264_nvenc",
    "The completed segment did not report h264_nvenc."
  );
  ensure(
    state.captureDiagnostics.outputWidth === 1_920 &&
      state.captureDiagnostics.outputHeight === 1_080,
    "The committed native segment is not 1920x1080."
  );
  ensure(
    Math.abs(state.captureDiagnostics.outputFps - 60) <= 0.1,
    "The committed native segment is not configured for 60 fps."
  );
  ensure(
    state.captureDiagnostics.targetVideoBitrate >=
      EXPECTED_MINIMUM_TARGET_BITRATE,
    "The quality preset target bitrate is unexpectedly low."
  );
  ensure(
    state.captureDiagnostics.hasAudio === true,
    "Native segment has no audio track."
  );
  if (diagnostics.completedSegmentCount !== null) {
    ensure(
      diagnostics.completedSegmentCount > 0,
      "Native segment list is empty."
    );
  }
}

async function waitForNativeCapture(electronApp, mainModuleUrl, timeoutMs) {
  return waitFor(
    "Native recorder with a completed segment",
    () => mainControl(electronApp, mainModuleUrl, "recorder-diagnostics"),
    (diagnostics) =>
      diagnostics.state.captureActive === true &&
      diagnostics.state.activeCaptureBackend === NATIVE_BACKEND &&
      diagnostics.state.captureDiagnostics?.backend === NATIVE_BACKEND &&
      diagnostics.state.bufferedSeconds >= 2.5,
    timeoutMs,
    500
  );
}

function assertSavedResult(result, outputDirectory, kind) {
  ensure(
    result?.ok === true,
    `${kind} failed: ${result?.error ?? "unknown error"}`
  );
  ensure(result.path, `${kind} returned no output path.`);
  ensure(
    isPathWithin(result.path, outputDirectory),
    `${kind} escaped the artifact folder.`
  );
  const stats = fs.statSync(result.path);
  ensure(
    stats.isFile() && stats.size >= 100_000,
    `${kind} output is missing or too small.`
  );
  return { absolutePath: result.path, bytes: stats.size };
}

function parseDurationSeconds(value) {
  const match = String(value).match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/u);
  if (!match) return null;
  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
}

function lastNumericMatch(text, pattern) {
  let result = null;
  for (const match of text.matchAll(pattern)) result = Number(match[1]);
  return Number.isFinite(result) ? result : null;
}

function numericMatches(text, pattern) {
  return [...text.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
}

function runFfmpeg(ffmpegPath, args, maxBuffer = 64 * 1024 * 1024) {
  const result = spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer,
    timeout: 120_000,
  });
  ensure(
    !result.error,
    `Bundled FFmpeg probe failed: ${result.error?.message}`
  );
  ensure(result.status === 0, "Bundled FFmpeg rejected a saved gameplay clip.");
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function inspectSavedMedia(ffmpegPath, clipPath, expectedKind) {
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const metadata = runFfmpeg(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-i",
    clipPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-f",
    "null",
    nullDevice,
  ]);
  const duration = parseDurationSeconds(
    metadata.match(/Duration:\s*([^,]+)/iu)?.[1]
  );
  const containerBitrateKbps = Number(
    metadata.match(/Duration:[^\n]*bitrate:\s*(\d+)\s*kb\/s/iu)?.[1] ?? 0
  );
  const videoLine =
    metadata.split(/\r?\n/u).find((line) => /Video:/u.test(line)) ?? "";
  const audioLine =
    metadata.split(/\r?\n/u).find((line) => /Audio:/u.test(line)) ?? "";
  const dimensions = videoLine.match(/(\d{3,5})x(\d{3,5})/u);
  const fps = Number(videoLine.match(/(\d+(?:\.\d+)?)\s*fps\b/iu)?.[1] ?? 0);
  const sampleRate = Number(audioLine.match(/(\d+)\s*Hz/iu)?.[1] ?? 0);
  ensure(duration && duration >= 2.5, `${expectedKind} is unexpectedly short.`);
  ensure(
    dimensions &&
      Number(dimensions[1]) === 1_920 &&
      Number(dimensions[2]) === 1_080,
    `${expectedKind} is not 1920x1080.`
  );
  ensure(
    fps >= 58.5 && fps <= 61.5,
    `${expectedKind} is not approximately 60 fps.`
  );
  ensure(/Video:\s*h264/iu.test(videoLine), `${expectedKind} is not H.264.`);
  ensure(/Audio:\s*aac/iu.test(audioLine), `${expectedKind} has no AAC audio.`);
  ensure(sampleRate === 48_000, `${expectedKind} audio is not 48 kHz.`);

  const videoTimeline = runFfmpeg(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-i",
    clipPath,
    "-map",
    "0:v:0",
    "-vf",
    "showinfo",
    "-an",
    "-f",
    "null",
    nullDevice,
  ]);
  const audioTimeline = runFfmpeg(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-i",
    clipPath,
    "-map",
    "0:a:0",
    "-af",
    "ashowinfo,volumedetect",
    "-vn",
    "-f",
    "null",
    nullDevice,
  ]);
  const videoEnd = lastNumericMatch(videoTimeline, /pts_time:([\d.]+)/gu);
  const audioEnd = lastNumericMatch(audioTimeline, /pts_time:([\d.]+)/gu);
  const videoPresentationTimestamps = numericMatches(
    videoTimeline,
    /pts_time:([\d.]+)/gu
  );
  const meanVolumeDb = Number(
    audioTimeline.match(/mean_volume:\s*(-?[\d.]+)\s*dB/iu)?.[1] ?? Number.NaN
  );
  ensure(
    videoEnd !== null && audioEnd !== null,
    `${expectedKind} timelines were unreadable.`
  );
  ensure(
    videoPresentationTimestamps.length >= 120,
    `${expectedKind} decoded too few video frames for a cadence proof.`
  );
  const cadenceDuration =
    videoPresentationTimestamps.at(-1) - videoPresentationTimestamps[0];
  const measuredCadenceFps =
    cadenceDuration > 0
      ? (videoPresentationTimestamps.length - 1) / cadenceDuration
      : 0;
  ensure(
    measuredCadenceFps >= 58.5 && measuredCadenceFps <= 61.5,
    `${expectedKind} decoded cadence was not approximately 60 fps.`
  );
  const avEndDeltaSeconds = Math.abs(videoEnd - audioEnd);
  ensure(
    avEndDeltaSeconds <= 0.35,
    `${expectedKind} A/V end drift exceeded 350 ms.`
  );
  ensure(
    Number.isFinite(meanVolumeDb),
    `${expectedKind} audio level was unreadable.`
  );
  ensure(meanVolumeDb > -75, `${expectedKind} system audio appears silent.`);

  return {
    durationSeconds: Math.round(duration * 1_000) / 1_000,
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
    fps,
    videoCodec: "h264",
    audioCodec: "aac",
    audioSampleRate: sampleRate,
    containerBitrateKbps,
    decodedFrames: videoPresentationTimestamps.length,
    measuredCadenceFps: Math.round(measuredCadenceFps * 100) / 100,
    avEndDeltaMilliseconds: Math.round(avEndDeltaSeconds * 1_000),
    meanVolumeDb,
  };
}

function relativeArtifact(context, absolutePath) {
  ensure(
    isPathWithin(absolutePath, context.artifactRoot),
    "Artifact path escaped its root."
  );
  return path
    .relative(context.artifactRoot, absolutePath)
    .split(path.sep)
    .join("/");
}

async function waitForTargetPid(electronApp, mainModuleUrl, timeoutMs) {
  return waitFor(
    "Game process/window detection",
    () => mainControl(electronApp, mainModuleUrl, "recorder-diagnostics"),
    (diagnostics) => diagnostics.targetPid > 0,
    timeoutMs,
    500
  );
}

async function runTarget(context, runtime, target) {
  const outputDirectory = path.join(context.clipRoot, target.id);
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const report = {
    id: target.id,
    executable: path.basename(target.executablePath),
    trackingExecutables: target.trackingExecutablePaths.map((item) =>
      path.basename(item)
    ),
    recorderConfiguration: { ...RECORDER_CONFIGURATION },
    launch: { throughGameHubIpc: false, targetWindowDetected: false },
    nativeCapture: null,
    replay: null,
    manualClip: null,
    privacy: null,
    close: null,
    status: "running",
    error: null,
  };
  const matcher = targetProcessMatcher(target);
  const baselineProcesses = listWindowsProcesses();
  const baselinePids = new Set(baselineProcesses.map((item) => item.pid));
  ensure(
    baselineProcesses.filter(matcher).length === 0,
    `${target.id} already has a matching process; refusing an ambiguous live test.`
  );
  ensure(
    baselineProcesses.filter(isNativeRecorderProcess).length === 0,
    "A native GameHub recorder FFmpeg process already exists."
  );
  let launched = false;
  let activeSet = false;
  let savedReplay = null;
  let savedManualClip = null;

  try {
    const patched = await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "patch-preferences",
      {
        patch: {
          onboardingComplete: true,
          hideToTrayOnGameStart: false,
          overlayEnabled: true,
          overlayPerformanceEnabled: false,
          musicProvider: "gamehub",
          gameRecorderEnabled: true,
          gameRecorderResolution: RECORDER_CONFIGURATION.resolution,
          gameRecorderFps: RECORDER_CONFIGURATION.fps,
          gameRecorderQualityPreset: RECORDER_CONFIGURATION.qualityPreset,
          gameRecorderInstantReplayEnabled: true,
          gameRecorderReplayDurationSeconds:
            RECORDER_CONFIGURATION.replayDurationSeconds,
          gameRecorderCaptureAudio: RECORDER_CONFIGURATION.captureGameAudio,
          gameRecorderOutputDirectory: outputDirectory,
        },
      }
    );
    ensure(
      isPathWithin(patched.databaseLocation, context.isolatedData),
      "Preference write was not directed to cloned LevelDB."
    );
    await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "prepare-target-game",
      { game: target.game }
    );

    await runtime.page.evaluate(
      ({ shop, objectId, executablePath, launchOptions }) =>
        globalThis.window.electron.openGame(
          shop,
          objectId,
          executablePath,
          launchOptions
        ),
      {
        shop: target.game.shop,
        objectId: target.game.objectId,
        executablePath: target.executablePath,
        launchOptions: target.game.launchOptions ?? null,
      }
    );
    launched = true;
    report.launch.throughGameHubIpc = true;

    await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "set-active-game",
      { game: target.game }
    );
    activeSet = true;
    await waitForTargetPid(
      runtime.electronApp,
      context.mainModuleUrl,
      context.gameReadyTimeoutMs
    );
    report.launch.targetWindowDetected = true;
    await runtime.page
      .evaluate(() => globalThis.window.electron.closeGameLauncherWindow())
      .catch(() => undefined);
    await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "focus-target"
    );
    await waitFor(
      "Game foreground focus",
      () =>
        mainControl(
          runtime.electronApp,
          context.mainModuleUrl,
          "recorder-diagnostics"
        ),
      (diagnostics) =>
        diagnostics.targetPid > 0 &&
        diagnostics.foregroundPid === diagnostics.targetPid,
      15_000,
      250
    );

    const initialNative = await waitForNativeCapture(
      runtime.electronApp,
      context.mainModuleUrl,
      45_000
    );
    assertRecorderConfiguration(initialNative.state, outputDirectory);
    report.nativeCapture = {
      backend: initialNative.state.captureDiagnostics.backend,
      encoder: initialNative.state.captureDiagnostics.encoderName,
      completedSegments: initialNative.completedSegmentCount,
      width: initialNative.state.captureDiagnostics.outputWidth,
      height: initialNative.state.captureDiagnostics.outputHeight,
      configuredFps: initialNative.state.captureDiagnostics.outputFps,
      measuredFps: initialNative.state.captureDiagnostics.encodedFps,
      targetVideoBitrate:
        initialNative.state.captureDiagnostics.targetVideoBitrate,
      recentEncodedBitrate:
        initialNative.state.captureDiagnostics.recentEncodedBitrate,
      audio: initialNative.state.captureDiagnostics.hasAudio,
    };
    assertNativeCompletedState(initialNative);

    await waitFor(
      "A useful instant-replay buffer",
      () =>
        runtime.page.evaluate(() =>
          globalThis.window.electron.gameRecorderGetState()
        ),
      (state) => state.bufferedSeconds >= 6 && state.captureActive,
      20_000,
      500
    );
    const replayResult = await runtime.page.evaluate(() =>
      globalThis.window.electron.gameRecorderSaveReplay()
    );
    savedReplay = assertSavedResult(
      replayResult,
      outputDirectory,
      "Instant Replay"
    );
    report.replay = {
      path: relativeArtifact(context, savedReplay.absolutePath),
      bytes: savedReplay.bytes,
      media: null,
    };

    const manualStarted = await runtime.page.evaluate(() =>
      globalThis.window.electron.gameRecorderStart()
    );
    ensure(
      manualStarted.status === "recording",
      "Manual recording did not start."
    );
    await sleep(8_000);
    const manualResult = await runtime.page.evaluate(() =>
      globalThis.window.electron.gameRecorderStop()
    );
    savedManualClip = assertSavedResult(
      manualResult,
      outputDirectory,
      "Manual recording"
    );
    report.manualClip = {
      path: relativeArtifact(context, savedManualClip.absolutePath),
      bytes: savedManualClip.bytes,
      media: null,
    };

    const beforePrivacy = await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "recorder-diagnostics"
    );
    ensure(
      beforePrivacy.state.captureActive,
      "Capture was inactive before Alt+Tab QA."
    );
    const privacyFocusStartedAt = controlWindowsProcessWindow(
      beforePrivacy.targetPid,
      "minimize"
    );
    const backgroundFocus = await waitFor(
      "A non-game foreground window after Alt+Tab",
      () =>
        mainControl(
          runtime.electronApp,
          context.mainModuleUrl,
          "recorder-diagnostics"
        ),
      (diagnostics) =>
        diagnostics.targetPid > 0 &&
        diagnostics.foregroundPid > 0 &&
        diagnostics.foregroundPid !== diagnostics.targetPid,
      5_000,
      50
    );
    await waitFor(
      "Recorder privacy stop after Alt+Tab",
      () =>
        mainControl(
          runtime.electronApp,
          context.mainModuleUrl,
          "recorder-diagnostics"
        ),
      (diagnostics) => diagnostics.state.captureActive === false,
      4_000,
      100
    );
    const privacyStopMilliseconds = Date.now() - privacyFocusStartedAt;
    ensure(
      privacyStopMilliseconds <= 1_500,
      "Recorder took longer than 1.5 seconds to stop after Alt+Tab."
    );
    await waitFor(
      "Native FFmpeg cleanup after Alt+Tab",
      () => listWindowsProcesses().filter(isNativeRecorderProcess),
      (processes) => processes.length === 0,
      8_000,
      200
    );
    await sleep(1_000);
    const stillStopped = await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "recorder-diagnostics"
    );
    ensure(
      stillStopped.state.captureActive === false,
      "Capture restarted in background."
    );

    await waitFor(
      "Game foreground focus after Alt+Tab return",
      async () => {
        controlWindowsProcessWindow(beforePrivacy.targetPid, "restore");
        await mainControl(
          runtime.electronApp,
          context.mainModuleUrl,
          "focus-target"
        );
        return mainControl(
          runtime.electronApp,
          context.mainModuleUrl,
          "recorder-diagnostics"
        );
      },
      (diagnostics) =>
        diagnostics.targetPid > 0 &&
        diagnostics.foregroundPid === diagnostics.targetPid,
      8_000,
      100
    );
    const resumed = await waitFor(
      "A new completed native segment after foreground resume",
      () =>
        mainControl(
          runtime.electronApp,
          context.mainModuleUrl,
          "recorder-diagnostics"
        ),
      (diagnostics) =>
        diagnostics.state.captureActive === true &&
        diagnostics.state.activeCaptureBackend === NATIVE_BACKEND &&
        diagnostics.state.captureDiagnostics?.backend === NATIVE_BACKEND &&
        diagnostics.newestSegmentEndedAt !== null &&
        diagnostics.newestSegmentEndedAt !== beforePrivacy.newestSegmentEndedAt,
      30_000,
      400
    );
    assertNativeCompletedState(resumed);
    report.privacy = {
      foregroundTransition: "minimize_restore",
      nonGameWindowTookForeground:
        backgroundFocus.foregroundPid !== backgroundFocus.targetPid,
      captureStoppedWithinMilliseconds: privacyStopMilliseconds,
      nativeFfmpegStopped: true,
      remainedStoppedWhileBackground: true,
      nativeCaptureResumed:
        resumed.state.activeCaptureBackend === NATIVE_BACKEND,
      newCompletedSegmentAfterResume: true,
    };

    const elevatedTarget =
      resumed.processAccess?.canInject === false &&
      resumed.processAccess?.errorCode === 5;
    let throughGameHubIpc = true;
    let qaHostTermination = false;
    if (elevatedTarget) {
      throughGameHubIpc = false;
      qaHostTermination = true;
      const qaProcesses = listWindowsProcesses().filter(
        (item) => !baselinePids.has(item.pid) && matcher(item)
      );
      ensure(qaProcesses.length > 0, "The elevated game process disappeared.");
      if (context.elevatedCleanupSignal) {
        const signalTemporaryPath = `${context.elevatedCleanupSignal}.part`;
        const payload = {
          schemaVersion: 1,
          runId: context.runId,
          processes: qaProcesses.map((item) => ({
            pid: item.pid,
            name: item.name,
          })),
        };
        fs.writeFileSync(
          signalTemporaryPath,
          `${JSON.stringify(payload)}\n`,
          "utf8"
        );
        fs.renameSync(signalTemporaryPath, context.elevatedCleanupSignal);
      } else {
        throw new Error(
          "The elevated target requires the guarded host-cleanup handshake."
        );
      }
    } else {
      await runtime.page.evaluate(
        ({ shop, objectId }) =>
          globalThis.window.electron.closeGame(shop, objectId),
        { shop: target.game.shop, objectId: target.game.objectId }
      );
    }
    const naturallyClosed = await waitFor(
      "Game process cleanup through GameHub",
      () =>
        listWindowsProcesses().filter(
          (item) => !baselinePids.has(item.pid) && matcher(item)
        ),
      (processes) => processes.length === 0,
      30_000,
      500
    );
    ensure(
      naturallyClosed.length === 0,
      "GameHub left a target process alive."
    );
    if (elevatedTarget && context.elevatedCleanupDoneSignal) {
      const completion = await waitFor(
        "Elevated host-cleanup acknowledgement",
        () => {
          if (!fs.existsSync(context.elevatedCleanupDoneSignal)) return null;
          return JSON.parse(
            fs.readFileSync(context.elevatedCleanupDoneSignal, "utf8")
          );
        },
        (value) => value?.runId === context.runId,
        10_000,
        100
      );
      ensure(
        completion.runId === context.runId,
        "The elevated cleanup acknowledgement belongs to another run."
      );
    }
    await waitFor(
      "Recorder cleanup after game exit",
      () => ({
        recorder: listWindowsProcesses().filter(isNativeRecorderProcess),
      }),
      (value) => value.recorder.length === 0,
      10_000,
      250
    );
    await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "clear-active-game",
      { game: target.game }
    );
    activeSet = false;
    const clearedRecorder = await mainControl(
      runtime.electronApp,
      context.mainModuleUrl,
      "recorder-diagnostics"
    );
    ensure(
      clearedRecorder.state.captureActive === false &&
        clearedRecorder.nativeSessionActive === false &&
        clearedRecorder.segmentDirectoryActive === false &&
        (!resumed.segmentDirectoryPath ||
          !fs.existsSync(resumed.segmentDirectoryPath)),
      "Recorder session resources remained after clearing the closed game."
    );
    report.close = {
      throughGameHubIpc,
      elevatedTarget,
      qaHostTermination,
      elevatedProductFallbackCoveredByTest: elevatedTarget,
      gameProcessesRemaining: 0,
      nativeRecorderProcessesRemaining: 0,
      recorderTempSessionRemaining: false,
    };
    // Decode/inspect only after the game and capture process have stopped. A
    // proof harness must not steal CPU/GPU time from the recording it measures.
    report.replay.media = inspectSavedMedia(
      context.previewFfmpegPath,
      savedReplay.absolutePath,
      "Instant Replay"
    );
    report.manualClip.media = inspectSavedMedia(
      context.previewFfmpegPath,
      savedManualClip.absolutePath,
      "Manual recording"
    );
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error = context.sanitizer.sanitizeText(
      error instanceof Error ? (error.stack ?? error.message) : error
    );
    throw Object.assign(
      error instanceof Error ? error : new Error(String(error)),
      {
        targetReport: report,
      }
    );
  } finally {
    if (launched) {
      const remainingGameProcesses = listWindowsProcesses().filter(
        (item) => !baselinePids.has(item.pid) && matcher(item)
      );
      for (const processItem of remainingGameProcesses) {
        terminateNewProcessTree(processItem.pid, baselinePids);
      }
    }
    if (activeSet) {
      await mainControl(
        runtime.electronApp,
        context.mainModuleUrl,
        "clear-active-game",
        { game: target.game }
      ).catch(() => undefined);
    }
    await sleep(800);
    const remaining = listWindowsProcesses().filter(
      (item) =>
        !baselinePids.has(item.pid) &&
        (matcher(item) || isNativeRecorderProcess(item))
    );
    for (const processItem of remaining) {
      terminateNewProcessTree(processItem.pid, baselinePids);
    }
  }
}

async function closeElectronTree(electronApp, launchedProcess) {
  await electronApp?.close().catch(() => undefined);
  const pid = launchedProcess?.pid;
  if (!pid) return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(100);
  }
  const baseline = new Set();
  terminateNewProcessTree(pid, baseline);
  await sleep(300);
  try {
    process.kill(pid, 0);
    throw new Error("The QA Electron process remained alive after cleanup.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("remained alive"))
      throw error;
  }
}

function makeChildEnvironment(isolatedPortableRoot) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^(?:AWS_|R2_|S3_)/iu.test(key) ||
      /^GAMEHUB_QA_/iu.test(key) ||
      /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIALS?)$/iu.test(key)
    ) {
      delete environment[key];
    }
  }
  delete environment.PLAYWRIGHT_PACKAGE;
  delete environment.GAMEHUB_LIVE_DATA;
  delete environment.GAMEHUB_R2_CREDENTIALS_URL;
  delete environment.GAMEHUB_API_URL;
  delete environment.MAIN_VITE_API_URL;
  delete environment.MAIN_VITE_R2_CREDENTIALS_URL;
  environment.APPDATA = isolatedPortableRoot;
  environment.LOCALAPPDATA = isolatedPortableRoot;
  environment.PORTABLE_EXECUTABLE_DIR = isolatedPortableRoot;
  environment.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  environment.GAMEHUB_READ_ONLY_VISUAL_QA = "true";
  return environment;
}

async function main() {
  ensure(process.platform === "win32", "Live recorder QA is Windows-only.");
  ensure(
    process.env.GAMEHUB_QA_LIVE_RECORDER_ACK === LIVE_ACKNOWLEDGEMENT,
    `Refusing to launch a game. Set GAMEHUB_QA_LIVE_RECORDER_ACK=${LIVE_ACKNOWLEDGEMENT} only for a coordinated live run.`
  );
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE?.trim();
  const sourceData = process.env.GAMEHUB_LIVE_DATA?.trim();
  ensure(
    playwrightPackage,
    "Set PLAYWRIGHT_PACKAGE to Playwright's package directory."
  );
  ensure(
    sourceData,
    "Set GAMEHUB_LIVE_DATA to the populated GameHub data folder."
  );
  ensure(
    path.isAbsolute(sourceData),
    "GAMEHUB_LIVE_DATA must be an absolute path."
  );

  const electronExecutable = path.join(
    repositoryRoot,
    "node_modules",
    "electron",
    "dist",
    "electron.exe"
  );
  const mainEntry = path.join(repositoryRoot, "out", "main", "index.js");
  const preloadEntry = path.join(repositoryRoot, "out", "preload", "index.mjs");
  const rendererEntry = path.join(
    repositoryRoot,
    "out",
    "renderer",
    "index.html"
  );
  for (const [requiredPath, label] of [
    [electronExecutable, "Electron executable"],
    [mainEntry, "final out/main build"],
    [preloadEntry, "final out/preload build"],
    [rendererEntry, "final out/renderer build"],
    [path.join(playwrightPackage, "index.mjs"), "Playwright package entry"],
  ]) {
    ensure(fs.existsSync(requiredPath), `The ${label} is missing.`);
  }

  const initialProcesses = listWindowsProcesses();
  const initialPids = new Set(initialProcesses.map((item) => item.pid));
  ensure(
    findConflictingGameHubProcesses(initialProcesses, repositoryRoot).length ===
      0,
    "Close every existing GameHub/dev Electron instance before live recorder QA."
  );
  const runId = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "");
  const artifactRoot = path.join(
    repositoryRoot,
    "artifacts",
    "qa-live-game-recorder",
    runId
  );
  const isolatedPortableRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), CLONE_PREFIX)
  );
  const isolatedData = path.join(isolatedPortableRoot, "data");
  const elevatedCleanupSignal = resolveElevatedCleanupSignal();
  const context = {
    repositoryRoot,
    sourceData: path.resolve(sourceData),
    electronExecutable,
    mainEntry,
    mainModuleUrl: pathToFileURL(mainEntry).href,
    artifactRoot,
    clipRoot: path.join(artifactRoot, "clips"),
    isolatedPortableRoot,
    isolatedData,
    previewFfmpegPath: path.join(
      path.dirname(mainEntry),
      "ffmpeg",
      "ffmpeg.exe"
    ),
    stagedPreviewDirectories: [],
    runId,
    elevatedCleanupSignal,
    elevatedCleanupDoneSignal: elevatedCleanupSignal
      ? `${elevatedCleanupSignal}.done`
      : null,
    gameReadyTimeoutMs: numericEnvironment(
      "GAMEHUB_QA_GAME_READY_TIMEOUT_MS",
      180_000,
      30_000,
      600_000
    ),
  };
  context.sanitizer = createSanitizer(context);
  const report = {
    schemaVersion: 1,
    kind: "gamehub-live-game-recorder-proof",
    runId,
    startedAt: new Date().toISOString(),
    safety: {
      executionAcknowledged: true,
      readOnlyVisualQa: true,
      isolatedClone: true,
      clonedDatabaseVerified: false,
      cloudSavesV2Disabled: false,
      liveDatabaseUnchanged: false,
      remoteMutationApisInvokedByHarness: false,
    },
    recorderConfiguration: { ...RECORDER_CONFIGURATION },
    cloudSaveGamesChecked: 0,
    targets: [],
    diagnostics: { rendererPageErrors: [], electronStderrEvents: 0 },
    cleanup: {
      electronStopped: false,
      cloneRemoved: false,
      previewDependenciesRemoved: false,
      nativeRecorderProcessesRemaining: null,
      gameProcessesRemaining: null,
    },
    fatalError: null,
    finishedAt: null,
    status: "running",
  };
  let electronApp = null;
  let launchedProcess = null;
  let liveDatabaseHashBefore = null;
  let runtime = null;

  try {
    liveDatabaseHashBefore = await hashDirectory(
      path.join(context.sourceData, "gamehub-db")
    );
    await prepareIsolatedClone(context);
    await stagePreviewDependency(context, "hydra-native", "hydra-native.node");
    await stagePreviewDependency(context, "ffmpeg", "ffmpeg.exe");
    ensure(
      fs.existsSync(context.previewFfmpegPath),
      "Bundled FFmpeg preview is missing."
    );

    const { _electron: electron } = await import(
      pathToFileURL(path.join(playwrightPackage, "index.mjs")).href
    );
    electronApp = await electron.launch({
      executablePath: context.electronExecutable,
      args: [
        context.mainEntry,
        "--no-sandbox",
        "--force-device-scale-factor=1",
        "--high-dpi-support=1",
      ],
      cwd: context.repositoryRoot,
      timeout: 60_000,
      env: makeChildEnvironment(context.isolatedPortableRoot),
    });
    launchedProcess = electronApp.process();
    launchedProcess.stderr?.on("data", () => {
      report.diagnostics.electronStderrEvents += 1;
    });
    const page = await findMainWindow(electronApp);
    page.on("pageerror", (error) => {
      report.diagnostics.rendererPageErrors.push(
        context.sanitizer.sanitizeText(error?.message ?? error)
      );
    });
    const inspected = await mainControl(
      electronApp,
      context.mainModuleUrl,
      "inspect"
    );
    ensure(
      inspected.windowsBefore === inspected.windowsAfter,
      "Resolving the cached main module unexpectedly created a window."
    );
    ensure(
      inspected.readOnlyVisualQa === true,
      "Read-only visual QA mode is inactive."
    );
    ensure(
      isPathWithin(inspected.databaseLocation, context.isolatedData),
      "Electron opened LevelDB outside the guarded clone."
    );
    report.safety.clonedDatabaseVerified = true;

    const library = await page.evaluate(() =>
      globalThis.window.electron.getLibrary()
    );
    ensure(
      Array.isArray(library) && library.length > 0,
      "The cloned library is empty."
    );
    const cloudGames = await disableAllCloudSync(page, library);
    const cloudVerification = await mainControl(
      electronApp,
      context.mainModuleUrl,
      "verify-cloud-sync-disabled",
      { games: cloudGames }
    );
    ensure(
      cloudVerification.checked === cloudGames.length &&
        cloudVerification.enabledCount === 0,
      "At least one cloned game still has V2 automatic Cloud Saves enabled."
    );
    report.cloudSaveGamesChecked = cloudVerification.checked;
    report.safety.cloudSavesV2Disabled = true;

    const specs = TARGET_SPECS.filter(
      (spec) =>
        !spec.optional || process.env.GAMEHUB_QA_INCLUDE_KHAZAN === "true"
    );
    const targets = specs.map((spec) =>
      resolveTarget(library, spec, context.sanitizer)
    );
    runtime = { electronApp, page };
    for (const target of targets) {
      try {
        report.targets.push(await runTarget(context, runtime, target));
      } catch (error) {
        report.targets.push(
          error?.targetReport ?? {
            id: target.id,
            status: "failed",
            error: context.sanitizer.sanitizeText(error),
          }
        );
        throw error;
      }
    }
    ensure(
      report.diagnostics.rendererPageErrors.length === 0,
      "The renderer emitted an unhandled page error during recorder QA."
    );
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.fatalError = context.sanitizer.sanitizeText(
      error instanceof Error ? (error.stack ?? error.message) : error
    );
  } finally {
    try {
      await closeElectronTree(electronApp, launchedProcess);
      report.cleanup.electronStopped = true;
    } catch (error) {
      report.fatalError ??= context.sanitizer.sanitizeText(error);
    }

    try {
      let finalProcesses = listWindowsProcesses();
      const targetProcessNames = new Set(
        report.targets.flatMap((target) => [
          target.executable?.toLowerCase(),
          ...(target.trackingExecutables ?? []).map((item) =>
            item.toLowerCase()
          ),
        ])
      );

      // A launcher can replace the tracked game process just after the
      // per-target finally block. Once Electron is stopped, sweep only exact
      // QA target names that did not exist before this run, waiting between
      // attempts so a late replacement cannot escape cleanup.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const qaGameProcesses = finalProcesses.filter(
          (item) =>
            !initialPids.has(item.pid) && targetProcessNames.has(item.name)
        );
        if (qaGameProcesses.length === 0) break;
        for (const processItem of qaGameProcesses) {
          terminateNewProcessTree(processItem.pid, initialPids);
        }
        await sleep(750);
        finalProcesses = listWindowsProcesses();
      }

      report.cleanup.nativeRecorderProcessesRemaining = finalProcesses.filter(
        isNativeRecorderProcess
      ).length;
      report.cleanup.gameProcessesRemaining = finalProcesses.filter(
        (item) =>
          !initialPids.has(item.pid) && targetProcessNames.has(item.name)
      ).length;
    } catch (error) {
      report.fatalError ??= context.sanitizer.sanitizeText(error);
    }

    try {
      assertGuardedClonePath(context.isolatedPortableRoot);
      await fs.promises.rm(context.isolatedPortableRoot, {
        recursive: true,
        force: true,
      });
      report.cleanup.cloneRemoved = !fs.existsSync(
        context.isolatedPortableRoot
      );
      ensure(
        report.cleanup.cloneRemoved,
        "The guarded QA clone remained on disk."
      );
    } catch (error) {
      report.fatalError ??= context.sanitizer.sanitizeText(error);
    }

    try {
      await removeStagedPreviewDependencies(context);
      report.cleanup.previewDependenciesRemoved =
        context.stagedPreviewDirectories.length === 0 ||
        context.stagedPreviewDirectories.every(
          (directory) => !fs.existsSync(directory)
        );
    } catch (error) {
      report.fatalError ??= context.sanitizer.sanitizeText(error);
    }

    try {
      for (const signalPath of [
        context.elevatedCleanupSignal,
        context.elevatedCleanupDoneSignal,
        context.elevatedCleanupSignal
          ? `${context.elevatedCleanupSignal}.part`
          : null,
      ]) {
        if (signalPath) fs.rmSync(signalPath, { force: true });
      }
    } catch (error) {
      report.fatalError ??= context.sanitizer.sanitizeText(error);
    }

    try {
      const liveDatabaseHashAfter = await hashDirectory(
        path.join(context.sourceData, "gamehub-db")
      );
      report.safety.liveDatabaseUnchanged =
        liveDatabaseHashBefore !== null &&
        liveDatabaseHashBefore === liveDatabaseHashAfter;
      ensure(
        report.safety.liveDatabaseUnchanged,
        "The live LevelDB changed during the isolated recorder run."
      );
    } catch (error) {
      report.fatalError ??= context.sanitizer.sanitizeText(error);
    }

    if (
      report.fatalError ||
      report.targets.some((target) => target.status !== "passed") ||
      !report.cleanup.electronStopped ||
      !report.cleanup.cloneRemoved ||
      report.cleanup.nativeRecorderProcessesRemaining !== 0 ||
      report.cleanup.gameProcessesRemaining !== 0 ||
      !report.safety.liveDatabaseUnchanged
    ) {
      report.status = "failed";
      process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString();
    await fs.promises.mkdir(context.artifactRoot, { recursive: true });
    const reportPath = path.join(context.artifactRoot, "report.json");
    const sanitizedReport = context.sanitizer.sanitizeValue(report);
    await fs.promises.writeFile(
      reportPath,
      `${JSON.stringify(sanitizedReport, null, 2)}\n`,
      "utf8"
    );
    console.log(
      `Recorder QA ${report.status}: ${report.targets.filter((item) => item.status === "passed").length}/${report.targets.length} target(s) passed.`
    );
    console.log(`Report: ${relativeArtifact(context, reportPath)}`);
  }
}

await main();
