/* global globalThis */

/**
 * Guarded, opt-in acceptance runner for the real in-game overlay.
 *
 * This script launches exactly one real game through the current unpackaged
 * GameHub build. It copies the populated portable profile first, strips every
 * stored credential, disables legacy and V2 automatic cloud saves in the copy,
 * and never copies the clone back.
 *
 * Required environment:
 *   PLAYWRIGHT_PACKAGE=<directory containing Playwright's index.mjs>
 *   GAMEHUB_LIVE_DATA=<populated portable GameHub data directory>
 *   GAMEHUB_QA_LIVE_OVERLAY_ACK=I_UNDERSTAND_THIS_LAUNCHES_A_GAME
 *   GAMEHUB_QA_OVERLAY_TARGET=spider-man-2|khazan
 *
 * Optional environment:
 *   GAMEHUB_QA_GAME_READY_TIMEOUT_MS=180000
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LIVE_ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_LAUNCHES_A_GAME";
const CLONE_PREFIX = "gamehub-live-overlay-qa-";
const REQUIRED_INPUT_CAPABILITIES = 0b1111;
const DIRECT_INPUT_CAPABILITY = 1 << 4;
const WINDOWS_GAMING_INPUT_CAPABILITY = 1 << 5;
const ROOT = path.resolve(import.meta.dirname, "..");

const TARGETS = Object.freeze({
  "spider-man-2": {
    id: "spider-man-2",
    objectId: "2651280",
    titlePatterns: [/marvel.*spider.?man\s*2/iu],
    executablePath: "C:\\Games\\Marvel's Spider-Man 2\\Spider-Man2.exe",
    trackingExecutablePaths: [],
    processNames: ["spider-man2.exe"],
    renderProcessName: "spider-man2.exe",
    requiredBackendCapability: WINDOWS_GAMING_INPUT_CAPABILITY,
    processRoot: "C:\\Games\\Marvel's Spider-Man 2",
  },
  khazan: {
    id: "khazan",
    objectId: "2680010",
    titlePatterns: [/khazan/iu, /first\s+berserker/iu],
    executablePath:
      "C:\\Games\\The First Berserker Khazan\\steamclient_loader_x64.exe",
    trackingExecutablePaths: [
      "C:\\Games\\The First Berserker Khazan\\BBQ\\Binaries\\Win64\\BBQ-Win64-Shipping.exe",
    ],
    processNames: ["steamclient_loader_x64.exe", "bbq-win64-shipping.exe"],
    renderProcessName: "bbq-win64-shipping.exe",
    requiredBackendCapability: DIRECT_INPUT_CAPABILITY,
    processRoot: "C:\\Games\\The First Berserker Khazan",
  },
});

const ANTI_CHEAT_PROCESS =
  /(?:easyanticheat|eaanticheat|battleye|beservice|bedaisy|(?:^|[\\/_. -])(?:vgk|vgc)(?:[\\/_. -]|$)|faceit|equ8|ricochet|randgrid|pnkbstr|xigncode|nprotect|gameguard|mhyprot|wellbia|hoyokprotect|anticheatexpert)/iu;

const CREDENTIAL_PREFERENCE_KEYS = [
  "ggDealsApiKey",
  "realDebridApiToken",
  "premiumizeApiToken",
  "allDebridApiToken",
  "torBoxApiToken",
  "retroAchievementsUsername",
  "retroAchievementsApiKey",
  "retroAchievementsToken",
  "spotifyClientId",
  "steamId",
  "steamApiKey",
  "steamUsername",
  "steamAvatarUrl",
  "epicAccountName",
  "gogRefreshToken",
  "gogUsername",
  "xboxAccessToken",
  "xboxUserHash",
  "xboxXstsToken",
  "xboxTokenExpiry",
  "xboxGamertag",
  "xboxXuid",
  "uploadcarePublicKey",
  "uploadcareSecretKey",
  "cloudSyncUserId",
  "cloudSyncAccountUserId",
  "cloudSyncLegacyUserIds",
  "cloudSyncNamespaceMigrationClaims",
  "ubisoftTicket",
  "ubisoftUserId",
  "ubisoftProfileId",
  "ubisoftUsername",
  "eaAccessToken",
  "eaRefreshToken",
  "eaTokenExpiry",
  "eaUsername",
  "eaPid",
  "exophaseUserId",
  "exophaseHydraAccountId",
  "exophaseExtraProfiles",
  "igdbClientId",
  "igdbClientSecret",
];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function numericEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  ensure(
    Number.isFinite(value) && value >= minimum && value <= maximum,
    `${name} must be between ${minimum} and ${maximum}.`
  );
  return Math.round(value);
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
  const resolved = path.resolve(cloneRoot);
  ensure(
    isPathWithin(resolved, os.tmpdir()),
    "Refusing cleanup because the clone is outside the OS temp directory."
  );
  ensure(
    path.basename(resolved).startsWith(CLONE_PREFIX),
    "Refusing cleanup because the clone has an unexpected prefix."
  );
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(
      /((?:access|refresh)?_?token|api_?key|client_?secret|password|cookie|authorization)(["'\s:=]+)[^\s,"'}]+/giu,
      "$1$2[redacted]"
    )
    .replace(/https?:\/\/[^\s"'`\\)]+/giu, "[url]")
    .replace(/(?:file:\/\/\/)?[a-z]:[\\/][^\r\n"'`<>|]*/giu, "[absolute-path]")
    .slice(0, 6_000);
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

function listWindowsProcesses() {
  const command = [
    "$ErrorActionPreference = 'Stop';",
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,CreationDate,Name,ExecutablePath,CommandLine |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  ensure(result.status === 0, "Could not enumerate Windows processes.");
  const parsed = JSON.parse(result.stdout || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    pid: Number(item.ProcessId) || 0,
    parentPid: Number(item.ParentProcessId) || 0,
    creationDate: String(item.CreationDate ?? ""),
    name: String(item.Name ?? "").toLowerCase(),
    executablePath: String(item.ExecutablePath ?? ""),
    commandLine: String(item.CommandLine ?? ""),
  }));
}

function processIdentity(item) {
  return `${item.pid}|${item.creationDate}|${item.executablePath.toLowerCase()}`;
}

function isConflictingGameHubProcess(item) {
  const repository = ROOT.toLowerCase();
  return (
    item.name === "gamehub.exe" ||
    (item.name === "electron.exe" &&
      item.commandLine.toLowerCase().includes(repository))
  );
}

function targetProcessMatcher(spec) {
  const names = new Set(spec.processNames);
  const root = `${path.resolve(spec.processRoot).toLowerCase()}${path.sep}`;
  return (item) => {
    if (names.has(item.name)) return true;
    const executable = item.executablePath
      ? path.resolve(item.executablePath).toLowerCase()
      : "";
    return executable.startsWith(root);
  };
}

function findGameRootAntiCheatProcesses(processes, spec) {
  return processes.filter((item) => {
    if (
      !ANTI_CHEAT_PROCESS.test(
        `${item.name} ${item.executablePath} ${item.commandLine}`
      )
    ) {
      return false;
    }
    if (!item.executablePath) return true;
    return isPathWithin(item.executablePath, spec.processRoot);
  });
}

function terminateValidatedTargetProcess(
  processItem,
  baselineIdentities,
  spec
) {
  if (
    !processItem?.pid ||
    baselineIdentities.has(processIdentity(processItem))
  ) {
    return false;
  }
  const current = listWindowsProcesses().find(
    (item) => item.pid === processItem.pid
  );
  if (
    !current ||
    !current.executablePath ||
    current.creationDate !== processItem.creationDate ||
    baselineIdentities.has(processIdentity(current)) ||
    !targetProcessMatcher(spec)(current)
  ) {
    return false;
  }
  const result = spawnSync(
    "taskkill.exe",
    ["/PID", String(current.pid), "/T", "/F"],
    {
      windowsHide: true,
      stdio: "ignore",
    }
  );
  return result.status === 0;
}

async function waitFor(
  description,
  readValue,
  predicate,
  timeoutMs,
  interval = 250
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
    await sleep(interval);
  }
  const detail =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`${description} timed out after ${timeoutMs} ms.${detail}`);
}

async function prepareClone(sourceData, cloneData) {
  const sourceDatabase = path.join(sourceData, "gamehub-db");
  ensure(
    fs.existsSync(sourceDatabase),
    "The populated GameHub database is missing."
  );
  await fs.promises.mkdir(cloneData, { recursive: true });
  await fs.promises.cp(sourceDatabase, path.join(cloneData, "gamehub-db"), {
    recursive: true,
  });
  for (const directory of ["Assets", "r2-image-cache", "ludusavi"]) {
    const source = path.join(sourceData, directory);
    if (fs.existsSync(source)) {
      await fs.promises.cp(source, path.join(cloneData, directory), {
        recursive: true,
      });
    }
  }

  const { ClassicLevel } = await import("classic-level");
  const database = new ClassicLevel(path.join(cloneData, "gamehub-db"), {
    valueEncoding: "json",
  });
  const games = database.sublevel("games", { valueEncoding: "json" });
  const automaticSync = database.sublevel(
    "cloud-save-automatic-sync-settings",
    {
      valueEncoding: "json",
    }
  );
  const spotifyAuth = database.sublevel("spotifyAuth", {
    valueEncoding: "json",
  });
  let cloudGamesDisabled = 0;
  try {
    await database.open();
    const preferences = await database
      .get("userPreferences")
      .catch((error) =>
        error?.code === "LEVEL_NOT_FOUND" ? {} : Promise.reject(error)
      );
    const scrubbed =
      preferences && typeof preferences === "object" ? { ...preferences } : {};
    for (const key of CREDENTIAL_PREFERENCE_KEYS) delete scrubbed[key];
    Object.assign(scrubbed, {
      onboardingComplete: true,
      launchInBigPicture: false,
      startMinimized: false,
      hideToTrayOnGameStart: false,
      overlayEnabled: true,
      overlayPerformanceEnabled: false,
      gameRecorderEnabled: false,
      gameRecorderInstantReplayEnabled: false,
      musicProvider: "gamehub",
    });
    const rows = await games.iterator().all();
    const batch = database.batch();
    for (const [key, game] of rows) {
      if (!game || game.isDeleted || !game.shop || !game.objectId) continue;
      batch.put(
        key,
        { ...game, automaticCloudSync: false },
        { sublevel: games }
      );
      batch.put(key, false, { sublevel: automaticSync });
      cloudGamesDisabled += 1;
    }
    batch.put("userPreferences", scrubbed);
    batch.del("auth");
    batch.del("user");
    batch.del("rpcPassword");
    await batch.write();
    await spotifyAuth.clear();
  } finally {
    await database.close().catch(() => undefined);
  }
  return { cloudGamesDisabled, credentialsStripped: true };
}

function makeChildEnvironment(cloneRoot) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^(?:AWS_|R2_|S3_|GAMEHUB_QA_)/iu.test(key) ||
      /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIALS?|AUTH)$/iu.test(
        key
      )
    ) {
      delete environment[key];
    }
  }
  for (const key of [
    "PLAYWRIGHT_PACKAGE",
    "GAMEHUB_LIVE_DATA",
    "GAMEHUB_API_URL",
    "GAMEHUB_R2_CREDENTIALS_URL",
    "MAIN_VITE_API_URL",
    "MAIN_VITE_R2_CREDENTIALS_URL",
  ]) {
    delete environment[key];
  }
  environment.APPDATA = cloneRoot;
  environment.LOCALAPPDATA = cloneRoot;
  environment.PORTABLE_EXECUTABLE_DIR = cloneRoot;
  environment.GAMEHUB_READ_ONLY_VISUAL_QA = "true";
  environment.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
  return environment;
}

async function findMainWindow(electronApp) {
  await electronApp.firstWindow({ timeout: 40_000 });
  let updateCheckerProceeded = false;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const mainWindow = electronApp.windows().find((candidate) => {
      const url = candidate.url();
      return (
        url.includes("/out/renderer/index.html") &&
        !url.includes("update-checker") &&
        !url.includes("achievement-notification") &&
        !url.includes("overlay") &&
        !url.includes("game-recorder-capture") &&
        !url.includes("game-launcher")
      );
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
    await sleep(250);
  }
  throw new Error("The isolated GameHub main window did not open.");
}

async function mainControl(electronApp, action, payload = {}) {
  return electronApp.evaluate(
    async ({ BrowserWindow, app }, request) => {
      const control = globalThis.__gameHubRecorderQaControl;
      const {
        levelKeys,
        database,
        gamesSublevel,
        OverlayManager,
        GameRecorderManager,
        NativeAddon,
        getCloudSaveAutomaticSyncEnabled,
      } = control ?? {};
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
          "The read-only main process did not expose overlay QA controls."
        );
      }

      const readDiagnostics = () => {
        const targetPid = OverlayManager.getTargetProcessId() || 0;
        const targetExecutable = OverlayManager.targetExecutable ?? null;
        const windows = BrowserWindow.getAllWindows().map((window) => ({
          url: window.webContents.getURL(),
          visible: window.isVisible(),
          focused: window.isFocused(),
          loading: window.webContents.isLoadingMainFrame(),
          bounds: window.getBounds(),
        }));
        return {
          activeGame: OverlayManager.getActiveGame()
            ? {
                shop: OverlayManager.getActiveGame().shop,
                objectId: OverlayManager.getActiveGame().objectId,
                libraryOrigin:
                  OverlayManager.getActiveGame().libraryOrigin ?? null,
              }
            : null,
          targetPid,
          targetExecutable,
          targetBounds:
            targetPid > 0
              ? NativeAddon.getProcessWindowBounds(targetPid)
              : null,
          foregroundPid: NativeAddon.getForegroundProcessId(),
          gameHubElevated: NativeAddon.isCurrentProcessElevated(),
          processAccess:
            targetPid > 0
              ? NativeAddon.getProcessAccessStatus(targetPid)
              : { canInject: false, errorCode: 0 },
          injectionRisk:
            targetPid > 0
              ? NativeAddon.getOverlayInjectionRisk(targetPid)
              : { safe: false, reason: "no-target", moduleName: null },
          gateStatus:
            targetPid > 0
              ? NativeAddon.getOverlayInputGateStatus(targetPid)
              : null,
          gateReadiness:
            targetPid > 0
              ? (OverlayManager.inputGate?.inspect(targetPid) ?? null)
              : null,
          overlayTogglePending: Boolean(OverlayManager.overlayTogglePending),
          electronMainPid: process.pid,
          recorderState: GameRecorderManager.getState(),
          windows,
        };
      };

      if (request.action === "inspect") {
        return {
          databaseLocation: database.location,
          appPath: app.getAppPath(),
          readOnlyVisualQa: process.env.GAMEHUB_READ_ONLY_VISUAL_QA === "true",
          authPresent: Boolean(
            await database.get(levelKeys.auth).catch(() => null)
          ),
          userPresent: Boolean(
            await database.get(levelKeys.user).catch(() => null)
          ),
        };
      }
      if (request.action === "verify-cloud-disabled") {
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
      if (request.action === "prepare-target") {
        const key = levelKeys.game(
          request.payload.game.shop,
          request.payload.game.objectId
        );
        const current = await gamesSublevel.get(key);
        if (!current)
          throw new Error("The selected game is absent from the clone.");
        await gamesSublevel.put(key, {
          ...current,
          executablePath: request.payload.game.executablePath,
          trackingExecutablePaths: request.payload.game.trackingExecutablePaths,
          automaticCloudSync: false,
        });
        return true;
      }
      if (request.action === "set-active") {
        OverlayManager.setActiveGame(request.payload.game);
        return true;
      }
      if (request.action === "clear-active") {
        OverlayManager.clearActiveGame(request.payload.game);
        return true;
      }
      if (request.action === "focus-target") {
        const targetPid = OverlayManager.getTargetProcessId() || 0;
        return {
          targetPid,
          focused: targetPid > 0 && NativeAddon.focusProcessWindow(targetPid),
          foregroundPid: NativeAddon.getForegroundProcessId(),
        };
      }
      if (request.action === "toggle-overlay") {
        OverlayManager.toggleOverlay();
        return true;
      }
      if (request.action === "hide-overlay") {
        OverlayManager.hideOverlay();
        return true;
      }
      if (request.action === "diagnostics") return readDiagnostics();
      throw new Error(`Unknown overlay QA action: ${request.action}`);
    },
    { action, payload }
  );
}

function chooseGame(library, spec) {
  const matches = library.filter(
    (game) =>
      game &&
      !game.isDeleted &&
      (String(game.objectId) === spec.objectId ||
        spec.titlePatterns.some((pattern) =>
          pattern.test(String(game.title ?? ""))
        ))
  );
  matches.sort((left, right) => {
    const leftExact = String(left.objectId) === spec.objectId ? 1 : 0;
    const rightExact = String(right.objectId) === spec.objectId ? 1 : 0;
    return rightExact - leftExact;
  });
  return matches[0] ?? null;
}

function findOverlayWindow(diagnostics) {
  return diagnostics.windows.find(
    (window) =>
      window.url.includes("#/overlay") &&
      !window.url.includes("overlay-toast") &&
      window.visible
  );
}

function findInputGateToast(diagnostics) {
  return diagnostics.windows.find(
    (window) =>
      window.url.includes("overlay-toast") &&
      window.url.includes("input-gate-error") &&
      window.visible
  );
}

function findReadyToast(diagnostics) {
  return diagnostics.windows.find(
    (window) =>
      window.url.includes("overlay-toast") &&
      !window.url.includes("input-gate-error") &&
      window.visible
  );
}

function boundsMatch(left, right, tolerance = 2) {
  return (
    left &&
    right &&
    ["x", "y", "width", "height"].every(
      (key) => Math.abs(Number(left[key]) - Number(right[key])) <= tolerance
    )
  );
}

function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function captureDesktopRegion(filePath, bounds) {
  ensure(
    bounds && bounds.width > 0 && bounds.height > 0,
    "Invalid capture bounds."
  );
  ensure(
    bounds.width <= 8192 && bounds.height <= 8192,
    "Capture bounds are unexpectedly large."
  );
  const command = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap(${Math.round(bounds.width)}, ${Math.round(bounds.height)}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen(${Math.round(bounds.x)}, ${Math.round(bounds.y)}, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
  $bitmap.Save(${powerShellLiteral(filePath)}, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}`;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );
  ensure(
    result.status === 0 && fs.existsSync(filePath),
    `Desktop capture failed: ${sanitizeText(result.stderr)}`
  );
}

function pngEvidence(filePath) {
  const bytes = fs.readFileSync(filePath);
  ensure(
    bytes.length >= 24 && bytes.subarray(1, 4).toString("ascii") === "PNG",
    `Screenshot is not a valid PNG: ${path.basename(filePath)}.`
  );
  return {
    file: path.basename(filePath),
    bytes: bytes.length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Ask Windows to foreground the real game for acceptance QA. This does not
 * alter the overlay's process-access, module-risk, injection, or gate checks;
 * it only supplies the user activation that a human naturally provides by
 * clicking/Alt-Tabbing to the game before pressing the overlay shortcut.
 */
function activateProcessWindowForQa(targetPid) {
  ensure(
    Number.isInteger(targetPid) && targetPid > 0,
    "A valid target PID is required for foreground activation."
  );
  const command = `$ErrorActionPreference = 'Stop'
$targetProcessId = ${targetPid}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameHubQaForeground {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
$targetWindow = [IntPtr]::Zero
[GameHubQaForeground]::EnumWindows({
  param($window, $unused)
  [uint32] $windowProcessId = 0
  [void] [GameHubQaForeground]::GetWindowThreadProcessId($window, [ref] $windowProcessId)
  if ($windowProcessId -eq $targetProcessId -and [GameHubQaForeground]::IsWindowVisible($window)) {
    $script:targetWindow = $window
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($targetWindow -eq [IntPtr]::Zero) { exit 2 }
if ([GameHubQaForeground]::IsIconic($targetWindow)) {
  [void] [GameHubQaForeground]::ShowWindowAsync($targetWindow, 9)
}
# A momentary, balanced Alt key sequence is the standard user-level way to
# satisfy Windows' foreground-lock policy. It is released in finally even if
# SetForegroundWindow throws.
[GameHubQaForeground]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
try {
  [void] [GameHubQaForeground]::SetForegroundWindow($targetWindow)
} finally {
  [GameHubQaForeground]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}
Start-Sleep -Milliseconds 150
[uint32] $foregroundProcessId = 0
[void] [GameHubQaForeground]::GetWindowThreadProcessId([GameHubQaForeground]::GetForegroundWindow(), [ref] $foregroundProcessId)
if ($foregroundProcessId -ne $targetProcessId) { exit 3 }
exit 0`;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64"),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
    }
  );
  return {
    activated: result.status === 0,
    exitCode: result.status,
    diagnostic: sanitizeText(result.stderr),
  };
}

async function screenshotElectronWindow(electronApp, kind, filePath) {
  const page = electronApp.windows().find((candidate) => {
    const url = candidate.url();
    if (kind === "overlay") {
      return url.includes("#/overlay") && !url.includes("overlay-toast");
    }
    if (kind === "gate-error") {
      return url.includes("overlay-toast") && url.includes("input-gate-error");
    }
    return url.includes("overlay-toast") && !url.includes("input-gate-error");
  });
  if (!page || page.isClosed()) return false;
  await page.screenshot({ path: filePath, animations: "disabled" });
  return fs.existsSync(filePath);
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
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  ensure(
    result.status === 0,
    "The QA Electron process could not be terminated."
  );
  await sleep(300);
  try {
    process.kill(pid, 0);
    throw new Error("The QA Electron process remained alive after cleanup.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("remained alive"))
      throw error;
  }
}

async function main() {
  ensure(process.platform === "win32", "Live overlay QA is Windows-only.");
  ensure(
    process.env.GAMEHUB_QA_LIVE_OVERLAY_ACK === LIVE_ACKNOWLEDGEMENT,
    "Refusing to launch a game without the exact live-overlay acknowledgement."
  );
  const targetId = process.env.GAMEHUB_QA_OVERLAY_TARGET?.trim();
  const spec = TARGETS[targetId];
  ensure(spec, "GAMEHUB_QA_OVERLAY_TARGET must be spider-man-2 or khazan.");
  const sourceData = process.env.GAMEHUB_LIVE_DATA?.trim();
  const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE?.trim();
  ensure(
    sourceData && path.isAbsolute(sourceData),
    "GAMEHUB_LIVE_DATA must be absolute."
  );
  ensure(playwrightPackage, "PLAYWRIGHT_PACKAGE is required.");
  for (const filePath of [
    spec.executablePath,
    ...spec.trackingExecutablePaths,
  ]) {
    ensure(
      fs.statSync(filePath).isFile(),
      `Missing live target ${path.basename(filePath)}.`
    );
  }

  const electronExecutable = path.join(
    ROOT,
    "node_modules",
    "electron",
    "dist",
    "electron.exe"
  );
  const mainEntry = path.join(ROOT, "out", "main", "index.js");
  for (const required of [
    electronExecutable,
    mainEntry,
    path.join(ROOT, "out", "preload", "index.mjs"),
    path.join(ROOT, "out", "renderer", "index.html"),
    path.join(ROOT, "hydra-native", "hydra-native.node"),
    path.join(ROOT, "hydra-native", "gamehub-inputhook.dll"),
    path.join(playwrightPackage, "index.mjs"),
  ]) {
    ensure(
      fs.existsSync(required),
      `Required current-build file is missing: ${path.basename(required)}.`
    );
  }

  const initialProcesses = listWindowsProcesses();
  const initialPids = new Set(initialProcesses.map((item) => item.pid));
  const initialIdentities = new Set(initialProcesses.map(processIdentity));
  const matcher = targetProcessMatcher(spec);
  ensure(
    initialProcesses.filter(isConflictingGameHubProcess).length === 0,
    "Close every existing GameHub/current-repo Electron instance before live overlay QA."
  );
  ensure(
    initialProcesses.filter(matcher).length === 0,
    `${spec.id} already has a matching process; refusing an ambiguous launch.`
  );
  ensure(
    findGameRootAntiCheatProcesses(initialProcesses, spec).length === 0,
    `An anti-cheat process is already active for ${spec.id}; refusing injection QA.`
  );

  const runId = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "");
  const artifactRoot = path.join(
    ROOT,
    "artifacts",
    "qa-live-overlay",
    `${runId}-${spec.id}`
  );
  const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), CLONE_PREFIX));
  const cloneData = path.join(cloneRoot, "data");
  const report = {
    schemaVersion: 1,
    kind: "gamehub-live-overlay-acceptance",
    runId,
    target: spec.id,
    startedAt: new Date().toISOString(),
    safety: {
      isolatedClone: true,
      credentialsStripped: false,
      cloudSavesDisabled: false,
      originalDatabaseUnchanged: false,
      originalProcessesPreserved: true,
    },
    library: null,
    launch: null,
    overlay: null,
    screenshots: [],
    cleanup: {
      gameProcessesRemaining: null,
      electronStopped: false,
      cloneRemoved: false,
    },
    error: null,
    finishedAt: null,
    outcome: "running",
  };
  const databaseSource = path.join(sourceData, "gamehub-db");
  let databaseHashBefore = null;
  let electronApp = null;
  let electronProcess = null;
  let page = null;
  let game = null;
  let launched = false;
  let activeSet = false;

  try {
    await fs.promises.mkdir(artifactRoot, { recursive: true });
    databaseHashBefore = await hashDirectory(databaseSource);
    const clonePreparation = await prepareClone(sourceData, cloneData);
    report.safety.credentialsStripped = clonePreparation.credentialsStripped;
    report.safety.cloudSavesDisabled = true;

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
    electronProcess = electronApp.process();
    page = await findMainWindow(electronApp);
    const inspected = await mainControl(electronApp, "inspect");
    ensure(inspected.readOnlyVisualQa, "Read-only visual QA mode is inactive.");
    ensure(
      path.resolve(inspected.appPath) === ROOT,
      "Electron resolved a native runtime outside the current repository root."
    );
    ensure(
      isPathWithin(inspected.databaseLocation, cloneData),
      "Electron opened LevelDB outside the guarded clone."
    );
    ensure(
      !inspected.authPresent && !inspected.userPresent,
      "Auth survived clone scrubbing."
    );

    const library = await page.evaluate(() =>
      globalThis.window.electron.getLibrary()
    );
    ensure(
      Array.isArray(library) && library.length > 0,
      "The cloned library is empty."
    );
    const cloudGames = library
      .filter((item) => item?.shop && item?.objectId && !item.isDeleted)
      .map((item) => ({ shop: item.shop, objectId: item.objectId }));
    const cloudVerification = await mainControl(
      electronApp,
      "verify-cloud-disabled",
      { games: cloudGames }
    );
    ensure(
      cloudVerification.checked === cloudGames.length &&
        cloudVerification.enabledCount === 0,
      "At least one cloned game still has automatic Cloud Saves enabled."
    );

    const selected = chooseGame(library, spec);
    ensure(selected, `${spec.id} is missing from the populated clone.`);
    ensure(
      selected.libraryOrigin === "catalog" ||
        selected.libraryOrigin === "custom",
      `${spec.id} is not eligible for local/offline overlay injection.`
    );
    game = {
      ...selected,
      executablePath: spec.executablePath,
      trackingExecutablePaths: spec.trackingExecutablePaths,
      automaticCloudSync: false,
    };
    report.library = {
      populatedGameCount: library.filter((item) => !item.isDeleted).length,
      title: game.title,
      shop: game.shop,
      objectId: game.objectId,
      libraryOrigin: game.libraryOrigin,
      executable: path.basename(game.executablePath),
      trackingExecutables: game.trackingExecutablePaths.map((item) =>
        path.basename(item)
      ),
    };
    await mainControl(electronApp, "prepare-target", { game });

    await page.evaluate(
      ({ shop, objectId, executablePath, launchOptions }) =>
        globalThis.window.electron.openGame(
          shop,
          objectId,
          executablePath,
          launchOptions
        ),
      {
        shop: game.shop,
        objectId: game.objectId,
        executablePath: game.executablePath,
        launchOptions: game.launchOptions ?? null,
      }
    );
    launched = true;
    await mainControl(electronApp, "set-active", { game });
    activeSet = true;

    const targetReady = await waitFor(
      "GameHub overlay render target",
      () => mainControl(electronApp, "diagnostics"),
      (value) =>
        value.targetPid > 0 &&
        value.targetBounds?.width > 0 &&
        path.basename(value.targetExecutable ?? "").toLowerCase() ===
          spec.renderProcessName,
      numericEnvironment(
        "GAMEHUB_QA_GAME_READY_TIMEOUT_MS",
        180_000,
        30_000,
        600_000
      ),
      500
    );
    ensure(
      findGameRootAntiCheatProcesses(listWindowsProcesses(), spec).length === 0,
      `A ${spec.id} anti-cheat process appeared after launch; refusing injection.`
    );
    ensure(
      targetReady.recorderState.captureActive === false,
      "The recorder unexpectedly activated during overlay-only QA."
    );
    report.launch = {
      throughGameHubIpc: true,
      targetPid: targetReady.targetPid,
      renderExecutable: path.basename(targetReady.targetExecutable),
      targetWindowDetected: true,
      gameHubElevated: targetReady.gameHubElevated,
      processAccess: targetReady.processAccess,
      injectionRisk: targetReady.injectionRisk,
    };
    await page
      .evaluate(() => globalThis.window.electron.closeGameLauncherWindow())
      .catch(() => undefined);
    const nativeFocusAttempt = await mainControl(electronApp, "focus-target");
    const qaFocusAttempt =
      nativeFocusAttempt.foregroundPid === targetReady.targetPid
        ? { activated: true, exitCode: 0, diagnostic: "" }
        : activateProcessWindowForQa(targetReady.targetPid);
    report.launch.focusAttempt = {
      ...nativeFocusAttempt,
      userActivation: qaFocusAttempt,
    };
    const foreground = await waitFor(
      "Game foreground focus",
      () => mainControl(electronApp, "diagnostics"),
      (value) => value.targetPid > 0 && value.foregroundPid === value.targetPid,
      8_000,
      250
    );

    const readyToast = await waitFor(
      "Overlay-ready toast or its completed lifecycle",
      () => mainControl(electronApp, "diagnostics"),
      (value) => findReadyToast(value) || !value.overlayTogglePending,
      2_000,
      100
    ).catch(() => null);
    if (readyToast && findReadyToast(readyToast)) {
      const toastPath = path.join(artifactRoot, `${spec.id}-ready-toast.png`);
      captureDesktopRegion(toastPath, readyToast.targetBounds);
      report.screenshots.push(pngEvidence(toastPath));
      const toastOnlyPath = path.join(
        artifactRoot,
        `${spec.id}-ready-toast-window.png`
      );
      if (
        await screenshotElectronWindow(
          electronApp,
          "ready-toast",
          toastOnlyPath
        )
      ) {
        report.screenshots.push(pngEvidence(toastOnlyPath));
      }
    }

    const beforeToggle = await mainControl(electronApp, "diagnostics");
    ensure(
      beforeToggle.foregroundPid === beforeToggle.targetPid,
      "The selected game lost foreground before the explicit toggle."
    );
    await mainControl(electronApp, "toggle-overlay");
    const toggleResult = await waitFor(
      "Overlay visibility or explicit input-gate refusal",
      () => mainControl(electronApp, "diagnostics"),
      (value) =>
        Boolean(findOverlayWindow(value)) ||
        Boolean(findInputGateToast(value)) ||
        (!value.overlayTogglePending &&
          (value.gateReadiness?.reason === "unsupported" ||
            value.processAccess?.canInject === false ||
            value.injectionRisk?.safe === false)),
      12_000,
      100
    );

    const overlayWindow = findOverlayWindow(toggleResult);
    const gateToast = findInputGateToast(toggleResult);
    if (overlayWindow) {
      const gate = toggleResult.gateStatus;
      ensure(
        gate?.ready === true,
        "Visible overlay lacks a positive hook handshake."
      );
      ensure(
        gate.blocked === true,
        "Visible overlay did not isolate game input."
      );
      ensure(
        gate.targetPid === toggleResult.targetPid &&
          gate.readyPid === toggleResult.targetPid &&
          gate.generation !== 0 &&
          gate.readyGeneration === gate.generation,
        "Overlay hook handshake is not scoped to the selected render PID."
      );
      ensure(
        (gate.capabilityMask & REQUIRED_INPUT_CAPABILITIES) ===
          REQUIRED_INPUT_CAPABILITIES,
        "Visible overlay lacks required keyboard/controller isolation capabilities."
      );
      ensure(
        (gate.capabilityMask & spec.requiredBackendCapability) ===
          spec.requiredBackendCapability,
        `${spec.id} lacks its required native input-backend capability.`
      );
      await sleep(750);
      const sustained = await mainControl(electronApp, "diagnostics");
      const sustainedWindow = findOverlayWindow(sustained);
      ensure(
        sustainedWindow && sustained.gateStatus?.ready === true,
        "The overlay did not remain visibly ready for the acceptance interval."
      );
      ensure(
        sustained.gateStatus.blocked === true,
        "The input gate released while the overlay was still visible."
      );
      ensure(
        sustainedWindow.focused &&
          sustained.foregroundPid === sustained.electronMainPid,
        "The visible overlay did not own foreground focus."
      );
      ensure(
        boundsMatch(sustainedWindow.bounds, sustained.targetBounds),
        "The overlay does not align with the real game bounds."
      );
      const overlayPage = electronApp.windows().find((candidate) => {
        const url = candidate.url();
        return (
          url.includes("#/overlay") &&
          !url.includes("overlay-toast") &&
          !candidate.isClosed()
        );
      });
      ensure(overlayPage, "The visible overlay renderer page is missing.");
      await overlayPage.locator(".overlay--full").waitFor({
        state: "visible",
        timeout: 3_000,
      });
      const overlayTitle = (
        await overlayPage.locator(".overlay-header__title").textContent()
      )?.trim();
      ensure(
        overlayTitle &&
          overlayTitle
            .toLocaleLowerCase()
            .includes(String(game.title).toLocaleLowerCase()),
        "The overlay title does not identify the launched game."
      );
      const compositePath = path.join(
        artifactRoot,
        `${spec.id}-overlay-over-game.png`
      );
      captureDesktopRegion(compositePath, sustained.targetBounds);
      report.screenshots.push(pngEvidence(compositePath));
      const overlayOnlyPath = path.join(
        artifactRoot,
        `${spec.id}-overlay-window.png`
      );
      if (
        await screenshotElectronWindow(electronApp, "overlay", overlayOnlyPath)
      ) {
        report.screenshots.push(pngEvidence(overlayOnlyPath));
      }
      report.overlay = {
        outcome: "visible",
        explicitToggle: true,
        sameIntegrityInjection: toggleResult.processAccess.canInject === true,
        injectionRiskSafe: toggleResult.injectionRisk.safe === true,
        inputGateReady: true,
        inputGateBlocked: true,
        capabilityMask: gate.capabilityMask,
        requiredBackendCapability: spec.requiredBackendCapability,
        unsupportedModuleMask: gate.unsupportedModuleMask,
        overlayFocused: sustainedWindow.focused,
        overlayTitle,
        boundsMatchGame: true,
        sustainedVisibleMs: 750,
      };
      report.outcome = "passed-visible";
      await mainControl(electronApp, "hide-overlay");
      await waitFor(
        "Overlay input release",
        () => mainControl(electronApp, "diagnostics"),
        (value) =>
          !findOverlayWindow(value) && value.gateStatus?.blocked !== true,
        5_000,
        100
      );
    } else {
      const readiness = toggleResult.gateReadiness;
      const accessBlocked = toggleResult.processAccess.canInject === false;
      const moduleBlocked = toggleResult.injectionRisk.safe === false;
      const unsupported =
        readiness?.reason === "unsupported" ||
        (toggleResult.gateStatus?.unsupportedModuleMask ?? 0) !== 0;
      ensure(
        accessBlocked || moduleBlocked || unsupported,
        "The overlay did not become visible and no safety refusal was proven."
      );
      if (gateToast) {
        const compositePath = path.join(
          artifactRoot,
          `${spec.id}-input-gate-refusal-over-game.png`
        );
        captureDesktopRegion(compositePath, toggleResult.targetBounds);
        report.screenshots.push(pngEvidence(compositePath));
        const toastPath = path.join(
          artifactRoot,
          `${spec.id}-input-gate-refusal-window.png`
        );
        if (
          await screenshotElectronWindow(electronApp, "gate-error", toastPath)
        ) {
          report.screenshots.push(pngEvidence(toastPath));
        }
      }
      report.overlay = {
        outcome: "blocked-by-safety",
        explicitToggle: true,
        sameIntegrityInjection: toggleResult.processAccess.canInject === true,
        processAccessErrorCode: toggleResult.processAccess.errorCode,
        injectionRiskSafe: toggleResult.injectionRisk.safe,
        injectionRiskReason: toggleResult.injectionRisk.reason,
        injectionRiskModule: toggleResult.injectionRisk.moduleName,
        gateReason: readiness?.reason ?? null,
        capabilityMask: toggleResult.gateStatus?.capabilityMask ?? 0,
        unsupportedModuleMask:
          toggleResult.gateStatus?.unsupportedModuleMask ?? 0,
        errorToastVisible: Boolean(gateToast),
      };
      report.outcome = "blocked-by-safety";
    }

    ensure(
      foreground.targetPid === toggleResult.targetPid,
      "Overlay target changed during the acceptance toggle."
    );
  } catch (error) {
    report.outcome = "failed";
    report.error = sanitizeText(
      error instanceof Error ? (error.stack ?? error.message) : error
    );
  } finally {
    if (launched && page && game) {
      await page
        .evaluate(
          ({ shop, objectId }) =>
            globalThis.window.electron.closeGame(shop, objectId),
          { shop: game.shop, objectId: game.objectId }
        )
        .catch(() => undefined);
    }
    if (activeSet && electronApp && game) {
      await mainControl(electronApp, "clear-active", { game }).catch(
        () => undefined
      );
    }

    if (launched) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const remaining = listWindowsProcesses().filter(
          (item) => !initialPids.has(item.pid) && matcher(item)
        );
        if (remaining.length === 0) break;
        if (attempt >= 10) {
          for (const processItem of remaining) {
            terminateValidatedTargetProcess(
              processItem,
              initialIdentities,
              spec
            );
          }
        }
        await sleep(500);
      }
    }

    try {
      await closeElectronTree(electronApp, electronProcess);
      report.cleanup.electronStopped = true;
    } catch (error) {
      report.error ??= sanitizeText(error);
      report.outcome = "failed";
    }

    try {
      const remaining = listWindowsProcesses().filter(
        (item) => !initialPids.has(item.pid) && matcher(item)
      );
      for (const processItem of remaining) {
        terminateValidatedTargetProcess(processItem, initialIdentities, spec);
      }
      await sleep(750);
      report.cleanup.gameProcessesRemaining = listWindowsProcesses().filter(
        (item) => !initialPids.has(item.pid) && matcher(item)
      ).length;
      if (report.cleanup.gameProcessesRemaining !== 0) {
        report.outcome = "failed";
        report.error ??= "A new exact target process remained after cleanup.";
      }
    } catch (error) {
      report.outcome = "failed";
      report.error ??= sanitizeText(error);
    }

    try {
      const databaseHashAfter = await hashDirectory(databaseSource);
      report.safety.originalDatabaseUnchanged =
        databaseHashBefore !== null && databaseHashBefore === databaseHashAfter;
      if (!report.safety.originalDatabaseUnchanged) {
        report.outcome = "failed";
        report.error ??= "The original populated database changed during QA.";
      }
    } catch (error) {
      report.outcome = "failed";
      report.error ??= sanitizeText(error);
    }

    try {
      assertGuardedClonePath(cloneRoot);
      await fs.promises.rm(cloneRoot, { recursive: true, force: true });
      report.cleanup.cloneRemoved = !fs.existsSync(cloneRoot);
      if (!report.cleanup.cloneRemoved) {
        report.outcome = "failed";
        report.error ??= "The guarded clone remained after cleanup.";
      }
    } catch (error) {
      report.outcome = "failed";
      report.error ??= sanitizeText(error);
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
  if (report.outcome === "failed") process.exitCode = 1;
}

await main();
