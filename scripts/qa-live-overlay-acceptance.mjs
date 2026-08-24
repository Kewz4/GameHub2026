/* global globalThis */

/**
 * Guarded, opt-in preflight/refusal runner for the current external-window
 * overlay path. This is not supervised-launch or in-process-compositor QA.
 *
 * `preflight-only` validates the current unpackaged GameHub build and an
 * isolated profile clone without launching a game. `expect-refusal` launches
 * exactly one selected game through the normal GameHub path and accepts only a
 * proved safety refusal. Both modes strip stored credentials, disable legacy
 * and V2 automatic cloud saves in the clone, and never copy the clone back.
 *
 * Required environment:
 *   PLAYWRIGHT_PACKAGE=<directory containing Playwright's index.mjs>
 *   GAMEHUB_LIVE_DATA=<populated portable GameHub data directory>
 *   GAMEHUB_QA_OVERLAY_TARGET=spider-man-2|khazan
 *   GAMEHUB_QA_LIVE_OVERLAY_MODE=preflight-only|expect-refusal
 *
 * Required only for expect-refusal (which launches the selected game):
 *   GAMEHUB_QA_LIVE_OVERLAY_ACK=I_UNDERSTAND_THIS_LAUNCHES_A_GAME
 *
 * Optional environment:
 *   GAMEHUB_QA_GAME_READY_TIMEOUT_MS=180000
 *   GAMEHUB_QA_MANUAL_FOCUS_TIMEOUT_MS=15000
 *   GAMEHUB_QA_SYNTHETIC_FOCUS_ACK=I_UNDERSTAND_THIS_SYNTHESIZES_A_BALANCED_ALT_KEY
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  evaluateExpectedOverlayRefusal,
  isSyntheticFocusExplicitlyAllowed,
  LIVE_OVERLAY_QA_MODE,
  parseLiveOverlayQaMode,
} from "./qa-live-overlay-policy.mjs";

const LIVE_ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_LAUNCHES_A_GAME";
const CLONE_PREFIX = "gamehub-live-overlay-qa-";
const ROOT = path.resolve(import.meta.dirname, "..");
const LIVE_INPUT_SWITCH_DECLARATION =
  /\bconst OVERLAY_LIVE_INPUT_ISOLATION_ENABLED = false;/u;
const LIVE_INPUT_ENABLED_DECLARATION =
  /\bconst OVERLAY_LIVE_INPUT_ISOLATION_ENABLED = true;/u;
let processInventoryDegraded = false;
let processInventorySource = "cim";

const TARGETS = Object.freeze({
  "spider-man-2": {
    id: "spider-man-2",
    objectId: "2651280",
    titlePatterns: [/marvel.*spider.?man\s*2/iu],
    executablePath: "C:\\Games\\Marvel's Spider-Man 2\\Spider-Man2.exe",
    trackingExecutablePaths: [],
    processNames: ["spider-man2.exe"],
    renderProcessName: "spider-man2.exe",
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

function inspectBuiltLiveInputPolicy(mainEntry) {
  const source = fs.readFileSync(mainEntry, "utf8");
  const disabled = LIVE_INPUT_SWITCH_DECLARATION.test(source);
  const enabled = LIVE_INPUT_ENABLED_DECLARATION.test(source);
  ensure(
    disabled && !enabled,
    "The current built main process does not contain the expected disabled live-input policy. Rebuild before refusal QA."
  );
  return Object.freeze({
    liveInputIsolationEnabled: false,
    killSwitchConfirmed: true,
    evidence: "built-main-disabled-constant",
  });
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

function parseWindowsProcessInventory(stdout) {
  const parsed = JSON.parse(stdout || "[]");
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    pid: Number(item.ProcessId) || 0,
    parentPid: Number(item.ParentProcessId) || 0,
    creationDate: String(item.CreationDate ?? ""),
    name: String(item.Name ?? "").toLowerCase(),
    executablePath: String(item.ExecutablePath ?? ""),
    commandLine: String(item.CommandLine ?? ""),
  }));
}

function runProcessInventoryCommand(command) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  try {
    const processes = parseWindowsProcessInventory(result.stdout);
    return processes.length > 0 ? processes : null;
  } catch {
    return null;
  }
}

function listWindowsProcesses() {
  const cimCommand = `$ErrorActionPreference = 'Stop'
$inventory = @(Get-CimInstance Win32_Process | ForEach-Object {
  $creationDate = ''
  try { $creationDate = $_.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString() } catch {}
  [PSCustomObject] @{
    ProcessId = $_.ProcessId
    ParentProcessId = $_.ParentProcessId
    CreationDate = $creationDate
    Name = [string] $_.Name
    ExecutablePath = [string] $_.ExecutablePath
    CommandLine = [string] $_.CommandLine
  }
})
$inventory | ConvertTo-Json -Compress`;
  if (!processInventoryDegraded) {
    const cimProcesses = runProcessInventoryCommand(cimCommand);
    if (cimProcesses) return cimProcesses;
  }

  const getProcessCommand = `$ErrorActionPreference = 'Stop'
$inventory = @(Get-Process -ErrorAction Stop | ForEach-Object {
  $executablePath = ''
  $creationDate = ''
  try { $executablePath = [string] $_.Path } catch {}
  try { $creationDate = $_.StartTime.ToFileTimeUtc().ToString() } catch {}
  [PSCustomObject] @{
    ProcessId = $_.Id
    ParentProcessId = 0
    CreationDate = $creationDate
    Name = if ($_.ProcessName) { "$($_.ProcessName).exe" } else { '' }
    ExecutablePath = $executablePath
    CommandLine = ''
  }
})
$inventory | ConvertTo-Json -Compress`;
  const getProcesses = runProcessInventoryCommand(getProcessCommand);
  ensure(getProcesses, "Could not enumerate Windows processes safely.");
  processInventoryDegraded = true;
  processInventorySource = "get-process";
  return getProcesses;
}

function processIdentity(item) {
  return `${item.pid}|${item.creationDate}|${item.executablePath.toLowerCase()}`;
}

function isConflictingGameHubProcess(item) {
  const repository = ROOT.toLowerCase();
  return (
    item.name === "gamehub.exe" ||
    (item.name === "electron.exe" &&
      (processInventoryDegraded ||
        item.commandLine.toLowerCase().includes(repository)))
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

function isExactTargetProcess(item, spec) {
  if (!item?.creationDate || !item.executablePath) return false;
  const expectedPaths = new Set(
    [spec.executablePath, ...spec.trackingExecutablePaths].map((filePath) =>
      path.resolve(filePath).toLowerCase()
    )
  );
  return (
    spec.processNames.includes(item.name) &&
    expectedPaths.has(path.resolve(item.executablePath).toLowerCase())
  );
}

function expectedRenderExecutablePath(spec) {
  return (
    spec.trackingExecutablePaths.find(
      (filePath) =>
        path.basename(filePath).toLowerCase() === spec.renderProcessName
    ) ?? spec.executablePath
  );
}

function isExactRenderProcess(item, spec) {
  if (!isExactTargetProcess(item, spec)) return false;
  return (
    path.resolve(item.executablePath).toLowerCase() ===
    path.resolve(expectedRenderExecutablePath(spec)).toLowerCase()
  );
}

export function sameProcessIdentity(left, right) {
  return (
    left?.pid > 0 &&
    left.pid === right?.pid &&
    left.creationDate !== "" &&
    left.creationDate === right.creationDate &&
    typeof left.executablePath === "string" &&
    left.executablePath !== "" &&
    typeof right?.executablePath === "string" &&
    right.executablePath !== "" &&
    path.resolve(left.executablePath).toLowerCase() ===
      path.resolve(right.executablePath).toLowerCase()
  );
}

export function diagnosticsMatchTargetIdentity(diagnostics, targetIdentity) {
  if (!diagnostics || !targetIdentity) return false;
  return (
    diagnostics.targetPid === targetIdentity.pid &&
    diagnostics.targetCreationTimeTicks === targetIdentity.creationDate &&
    typeof diagnostics.targetExecutable === "string" &&
    diagnostics.targetExecutable !== "" &&
    typeof targetIdentity.executablePath === "string" &&
    targetIdentity.executablePath !== "" &&
    path.resolve(diagnostics.targetExecutable).toLowerCase() ===
      path.resolve(targetIdentity.executablePath).toLowerCase()
  );
}

export function isBoundRenderTargetState(
  state,
  spec,
  targetIdentity,
  { requireForeground = false, requireBounds = false } = {}
) {
  const diagnostics = state?.diagnostics;
  const processItem = state?.processItem;
  return Boolean(
    diagnosticsMatchTargetIdentity(diagnostics, targetIdentity) &&
      sameProcessIdentity(processItem, targetIdentity) &&
      isExactTargetProcess(processItem, spec) &&
      isExactRenderProcess(processItem, spec) &&
      (!requireForeground ||
        diagnostics.foregroundPid === targetIdentity.pid) &&
      (!requireBounds ||
        (diagnostics.targetBounds?.width > 0 &&
          diagnostics.targetBounds?.height > 0))
  );
}

async function readBoundRenderTargetState(electronApp, targetIdentity) {
  const diagnostics = await mainControl(electronApp, "diagnostics");
  const processItem = listWindowsProcesses().find(
    (item) => item.pid === targetIdentity.pid
  );
  return { diagnostics, processItem: processItem ?? null };
}

function ensureBoundRenderTargetState(
  state,
  spec,
  targetIdentity,
  description,
  options
) {
  ensure(
    isBoundRenderTargetState(state, spec, targetIdentity, options),
    `The exact render-target PID/path/creation identity changed ${description}.`
  );
  return state.diagnostics;
}

async function waitForBoundRenderTargetState(
  description,
  electronApp,
  spec,
  targetIdentity,
  predicate,
  timeoutMs,
  interval = 250
) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readBoundRenderTargetState(electronApp, targetIdentity);
    ensureBoundRenderTargetState(
      lastState,
      spec,
      targetIdentity,
      `while waiting for ${description}`
    );
    if (predicate(lastState)) return lastState;
    await sleep(interval);
  }
  throw new Error(
    `${description} timed out after ${timeoutMs} ms while the exact render-target identity remained bound.`
  );
}

function makeRenderTargetIdentityCheckpoint(
  state,
  spec,
  targetIdentity,
  phase,
  options = {}
) {
  const diagnostics = ensureBoundRenderTargetState(
    state,
    spec,
    targetIdentity,
    `at the ${phase} checkpoint`,
    options
  );
  return Object.freeze({
    phase,
    verifiedAt: new Date().toISOString(),
    verified: true,
    pid: diagnostics.targetPid,
    creationTimeTicks: diagnostics.targetCreationTimeTicks,
    executablePath: diagnostics.targetExecutable,
    foregroundPid: diagnostics.foregroundPid,
    targetBounds: diagnostics.targetBounds
      ? { ...diagnostics.targetBounds }
      : null,
    diagnosticsIdentityMatched: true,
    processInventoryIdentityMatched: true,
    exactConfiguredRenderPathMatched: true,
  });
}

function stopExactProcessWithPowerShell(processItem) {
  if (!/^\d+$/u.test(processItem.creationDate)) return false;
  const expectedPath = path.resolve(processItem.executablePath);
  const command = `$ErrorActionPreference = 'Stop'
$targetProcessId = ${processItem.pid}
$expectedPath = ${powerShellLiteral(expectedPath)}
$expectedCreationDate = ${powerShellLiteral(processItem.creationDate)}
$target = Get-Process -Id $targetProcessId -ErrorAction Stop
$currentPath = ''
$currentCreationDate = ''
try { $currentPath = [System.IO.Path]::GetFullPath([string] $target.Path) } catch { exit 3 }
try { $currentCreationDate = $target.StartTime.ToFileTimeUtc().ToString() } catch { exit 4 }
if (-not [string]::Equals($currentPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { exit 5 }
if ($currentCreationDate -ne $expectedCreationDate) { exit 6 }
Stop-Process -InputObject $target -Force -ErrorAction Stop`;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 5_000 }
  );
  return result.status === 0;
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
    !sameProcessIdentity(current, processItem) ||
    baselineIdentities.has(processIdentity(current)) ||
    !isExactTargetProcess(current, spec)
  ) {
    return false;
  }
  return stopExactProcessWithPowerShell(current);
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
          targetCreationTimeTicks:
            targetPid > 0
              ? NativeAddon.getProcessCreationTimeTicks(targetPid)
              : null,
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
          electronMainPid: process.pid,
          electronMainCreationTimeTicks:
            NativeAddon.getProcessCreationTimeTicks(process.pid),
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

function overlayToastKind(url) {
  const marker = "#/overlay-toast";
  const value = String(url ?? "");
  const fragmentIndex = value.indexOf("#");
  if (fragmentIndex < 0) return null;
  const fragment = value.slice(fragmentIndex);
  if (fragment !== marker && !fragment.startsWith(`${marker}?`)) return null;
  const suffix = fragment.slice(marker.length);
  if (suffix !== "" && !suffix.startsWith("?")) return null;
  const parameters = new URLSearchParams(suffix.slice(1));
  if (parameters.get("kind") === "input-gate-error") return "refusal";
  return suffix === "" ? "ready" : null;
}

export function findReadyToast(diagnostics) {
  return diagnostics?.windows?.find(
    (window) => window.visible && overlayToastKind(window.url) === "ready"
  );
}

export function findInputGateToast(diagnostics) {
  return diagnostics?.windows?.find(
    (window) => window.visible && overlayToastKind(window.url) === "refusal"
  );
}

export function hasRequiredToastEvidence(diagnostics, kind) {
  if (kind === "ready") return Boolean(findReadyToast(diagnostics));
  if (kind === "refusal") return Boolean(findInputGateToast(diagnostics));
  return false;
}

export function requiredToastEvidenceForMode(mode) {
  if (mode === LIVE_OVERLAY_QA_MODE.preflightOnly) return null;
  if (mode === LIVE_OVERLAY_QA_MODE.expectRefusal) return "refusal";
  throw new Error(`Unsupported live-overlay QA mode: ${String(mode)}.`);
}

export function boundsMatch(left, right, tolerance = 2) {
  return Boolean(
    left &&
      right &&
      ["x", "y", "width", "height"].every(
        (key) => Math.abs(left[key] - right[key]) <= tolerance
      )
  );
}

export function validateRightEdgeToastGeometry(
  toast,
  targetBounds,
  kind = "ready"
) {
  ensure(toast?.bounds, "The overlay notification has no window bounds.");
  ensure(
    targetBounds?.width > 0 && targetBounds?.height > 0,
    "The overlay notification has no target bounds."
  );
  const targetRight = targetBounds.x + targetBounds.width;
  const toastRight = toast.bounds.x + toast.bounds.width;
  const rightEdgeDeltaDip = toastRight - targetRight;
  const horizontallyContained =
    toast.bounds.x >= targetBounds.x && toastRight <= targetRight + 2;
  const verticallyContained =
    toast.bounds.y >= targetBounds.y &&
    toast.bounds.y + toast.bounds.height <=
      targetBounds.y + targetBounds.height;
  ensure(
    Math.abs(rightEdgeDeltaDip) <= 2,
    "The overlay notification is not attached to the target's right edge."
  );
  ensure(
    horizontallyContained && verticallyContained,
    "The overlay notification is not contained by the target."
  );
  ensure(
    kind === "ready" || kind === "refusal",
    "Unknown overlay notification kind."
  );
  const narrow = toast.bounds.width < 360;
  const maxHeightDip =
    kind === "refusal" ? (narrow ? 96 : 80) : narrow ? 82 : 64;
  const compactHeight =
    toast.bounds.height > 0 && toast.bounds.height <= maxHeightDip;
  ensure(
    compactHeight,
    "The overlay notification retained an oversized empty host area."
  );
  return Object.freeze({
    targetRight,
    toastRight,
    rightEdgeDeltaDip,
    attachedToRightEdge: true,
    horizontallyContained,
    verticallyContained,
    maxHeightDip,
    compactHeight,
    bounds: { ...toast.bounds },
  });
}

async function inspectToastPresentation(electronApp, kind) {
  const page = electronApp.windows().find((candidate) => {
    const toastKind = overlayToastKind(candidate.url());
    return kind === "gate-error"
      ? toastKind === "refusal"
      : toastKind === "ready";
  });
  ensure(page && !page.isClosed(), "The overlay notification renderer closed.");
  const presentation = await page.evaluate(() => {
    const toast = document.querySelector(".overlay-toast");
    if (!(toast instanceof HTMLElement)) return null;
    const style = getComputedStyle(toast);
    const bounds = toast.getBoundingClientRect();
    const body = toast.querySelector(".overlay-toast__body");
    const bodyBounds =
      body instanceof HTMLElement ? body.getBoundingClientRect() : null;
    const directContentBounds = Array.from(
      toast.querySelectorAll(
        ":scope > .overlay-toast__dot, :scope > .overlay-toast__body"
      )
    )
      .filter((element) => element instanceof HTMLElement)
      .map((element) => element.getBoundingClientRect());
    const contentTop = Math.min(
      bodyBounds?.top ?? Number.POSITIVE_INFINITY,
      ...directContentBounds.map((candidate) => candidate.top)
    );
    const contentBottom = Math.max(
      bodyBounds?.bottom ?? Number.NEGATIVE_INFINITY,
      ...directContentBounds.map((candidate) => candidate.bottom)
    );
    const animation = toast
      .getAnimations()
      .find(
        (candidate) =>
          candidate.animationName === "overlay-toast-enter-from-right"
      );
    const keyframes =
      animation && typeof animation.effect?.getKeyframes === "function"
        ? animation.effect.getKeyframes()
        : [];
    const transformOriginX = Number.parseFloat(
      style.transformOrigin.split(/\s+/u)[0] ?? ""
    );
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      frameTransforms: keyframes.map((frame) => String(frame.transform ?? "")),
      transformOrigin: style.transformOrigin,
      transformOriginX,
      transformOriginRightDelta: Number.isFinite(transformOriginX)
        ? transformOriginX - bounds.width
        : null,
      borderTopRightRadius: style.borderTopRightRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
      hostHeight: bounds.height,
      windowHeight: window.innerHeight,
      hostClientHeight: toast.clientHeight,
      hostScrollHeight: toast.scrollHeight,
      contentTopGap: Number.isFinite(contentTop)
        ? Math.max(0, contentTop - bounds.top)
        : null,
      contentBottomGap: Number.isFinite(contentBottom)
        ? Math.max(0, bounds.bottom - contentBottom)
        : null,
    };
  });
  ensure(presentation, "The overlay notification element did not render.");
  return validateToastPresentationEvidence(presentation);
}

export function validateToastPresentationEvidence(presentation) {
  ensure(presentation, "The overlay notification presentation is missing.");
  const animationNames = presentation.animationName
    .split(",")
    .map((name) => name.trim());
  const hasNonzeroAnimationDuration = presentation.animationDuration
    .split(",")
    .map((duration) => duration.trim())
    .some((duration) => {
      const value = Number.parseFloat(duration);
      return Number.isFinite(value) && value > 0;
    });
  const startsOutsideRight = presentation.frameTransforms.some((value) =>
    /translateX\(100%\)/u.test(value)
  );
  const settlesAtOrigin = presentation.frameTransforms.some((value) =>
    /translateX\(0(?:px|%)?\)/u.test(value)
  );
  const transformOriginAtRightEdge =
    presentation.transformOriginRightDelta !== null &&
    Math.abs(presentation.transformOriginRightDelta) <= 1;
  const rightOriginAnimation =
    animationNames.includes("overlay-toast-enter-from-right") &&
    hasNonzeroAnimationDuration &&
    startsOutsideRight &&
    settlesAtOrigin &&
    transformOriginAtRightEdge;
  ensure(
    rightOriginAnimation,
    "The overlay notification did not prove a right-to-left entry animation."
  );
  const flushRightEdgeCorners =
    presentation.borderTopRightRadius === "0px" &&
    presentation.borderBottomRightRadius === "0px";
  ensure(
    flushRightEdgeCorners,
    "The overlay notification still renders as a floating four-corner card."
  );
  const noOverflow =
    presentation.hostScrollHeight <= presentation.hostClientHeight + 1;
  const maxContentBottomGapDip = 16;
  const verticallyBalanced =
    presentation.contentTopGap !== null &&
    presentation.contentBottomGap !== null &&
    Math.abs(presentation.contentTopGap - presentation.contentBottomGap) <= 1;
  const noBottomEmptySpace =
    Math.abs(presentation.hostHeight - presentation.windowHeight) <= 1 &&
    noOverflow &&
    presentation.contentBottomGap !== null &&
    presentation.contentBottomGap <= maxContentBottomGapDip &&
    verticallyBalanced;
  ensure(
    noBottomEmptySpace,
    "The overlay notification retained excess bottom space or overflow."
  );
  return Object.freeze({
    ...presentation,
    hasNonzeroAnimationDuration,
    startsOutsideRight,
    settlesAtOrigin,
    transformOriginAtRightEdge,
    rightOriginAnimation,
    flushRightEdgeCorners,
    noOverflow,
    maxContentBottomGapDip,
    verticallyBalanced,
    noBottomEmptySpace,
  });
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
 * After the manual checkpoint, temporarily join the foreground and target
 * threads' input queues so Windows can honor SetForegroundWindow. This does not
 * generate keyboard, mouse, or controller input. The PowerShell process first
 * revalidates the exact PID, executable path, and creation FILETIME.
 */
function attachProcessWindowActivationForQa(targetIdentity) {
  ensure(
    targetIdentity?.pid > 4 &&
      /^\d+$/u.test(targetIdentity.creationDate ?? "") &&
      path.isAbsolute(targetIdentity.executablePath ?? ""),
    "An exact target identity is required for foreground queue attachment."
  );
  const command = `$ErrorActionPreference = 'Stop'
$targetProcessId = ${targetIdentity.pid}
$expectedPath = ${powerShellLiteral(path.resolve(targetIdentity.executablePath))}
$expectedCreationDate = ${powerShellLiteral(targetIdentity.creationDate)}
$target = Get-Process -Id $targetProcessId -ErrorAction Stop
$currentPath = ''
$currentCreationDate = ''
try { $currentPath = [System.IO.Path]::GetFullPath([string] $target.Path) } catch { exit 3 }
try { $currentCreationDate = $target.StartTime.ToFileTimeUtc().ToString() } catch { exit 4 }
if (-not [string]::Equals($currentPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { exit 5 }
if ($currentCreationDate -ne $expectedCreationDate) { exit 6 }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameHubQaAttachedForeground {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hwnd, bool altTab);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$targetWindow = [IntPtr]::Zero
[GameHubQaAttachedForeground]::EnumWindows({
  param($window, $unused)
  [uint32] $windowProcessId = 0
  [void] [GameHubQaAttachedForeground]::GetWindowThreadProcessId($window, [ref] $windowProcessId)
  if ($windowProcessId -eq $targetProcessId -and [GameHubQaAttachedForeground]::IsWindowVisible($window)) {
    $script:targetWindow = $window
    return $false
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($targetWindow -eq [IntPtr]::Zero) { exit 7 }
$foregroundWindow = [GameHubQaAttachedForeground]::GetForegroundWindow()
[uint32] $foregroundProcessId = 0
$foregroundThread = if ($foregroundWindow -ne [IntPtr]::Zero) {
  [GameHubQaAttachedForeground]::GetWindowThreadProcessId($foregroundWindow, [ref] $foregroundProcessId)
} else { 0 }
[uint32] $verifiedTargetProcessId = 0
$targetThread = [GameHubQaAttachedForeground]::GetWindowThreadProcessId($targetWindow, [ref] $verifiedTargetProcessId)
if ($verifiedTargetProcessId -ne $targetProcessId -or $targetThread -eq 0) { exit 8 }
$currentThread = [GameHubQaAttachedForeground]::GetCurrentThreadId()
$attachedForeground = $false
$attachedTarget = $false
try {
  if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
    $attachedForeground = [GameHubQaAttachedForeground]::AttachThreadInput($currentThread, $foregroundThread, $true)
  }
  if ($targetThread -ne $currentThread) {
    $attachedTarget = [GameHubQaAttachedForeground]::AttachThreadInput($currentThread, $targetThread, $true)
  }
  if ([GameHubQaAttachedForeground]::IsIconic($targetWindow)) {
    [void] [GameHubQaAttachedForeground]::ShowWindowAsync($targetWindow, 9)
  }
  [void] [GameHubQaAttachedForeground]::BringWindowToTop($targetWindow)
  [void] [GameHubQaAttachedForeground]::SetForegroundWindow($targetWindow)
  [GameHubQaAttachedForeground]::SwitchToThisWindow($targetWindow, $true)
  [void] [GameHubQaAttachedForeground]::SetFocus($targetWindow)
} finally {
  if ($attachedTarget) {
    [void] [GameHubQaAttachedForeground]::AttachThreadInput($currentThread, $targetThread, $false)
  }
  if ($attachedForeground) {
    [void] [GameHubQaAttachedForeground]::AttachThreadInput($currentThread, $foregroundThread, $false)
  }
}
Start-Sleep -Milliseconds 150
[uint32] $finalForegroundProcessId = 0
[void] [GameHubQaAttachedForeground]::GetWindowThreadProcessId([GameHubQaAttachedForeground]::GetForegroundWindow(), [ref] $finalForegroundProcessId)
if ($finalForegroundProcessId -ne $targetProcessId) { exit 10 }
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

/**
 * Explicitly opted-in last resort. This sends one balanced Alt down/up pair
 * around SetForegroundWindow and is never called by the default QA path.
 */
function synthesizeProcessWindowActivationForQa(targetIdentity) {
  ensure(
    targetIdentity?.pid > 4 &&
      /^\d+$/u.test(targetIdentity.creationDate ?? "") &&
      path.isAbsolute(targetIdentity.executablePath ?? ""),
    "An exact target identity is required for synthetic foreground activation."
  );
  const command = `$ErrorActionPreference = 'Stop'
$targetProcessId = ${targetIdentity.pid}
$expectedPath = ${powerShellLiteral(path.resolve(targetIdentity.executablePath))}
$expectedCreationDate = ${powerShellLiteral(targetIdentity.creationDate)}
$target = Get-Process -Id $targetProcessId -ErrorAction Stop
$currentPath = ''
$currentCreationDate = ''
try { $currentPath = [System.IO.Path]::GetFullPath([string] $target.Path) } catch { exit 3 }
try { $currentCreationDate = $target.StartTime.ToFileTimeUtc().ToString() } catch { exit 4 }
if (-not [string]::Equals($currentPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { exit 5 }
if ($currentCreationDate -ne $expectedCreationDate) { exit 6 }
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

async function acquireGameForeground({
  electronApp,
  spec,
  targetPid,
  targetIdentity,
  manualTimeoutMs,
  syntheticFocusAllowed,
}) {
  const identityCheckpoints = [];
  const native = await mainControl(electronApp, "focus-target");
  const afterNativeState = await readBoundRenderTargetState(
    electronApp,
    targetIdentity
  );
  identityCheckpoints.push(
    makeRenderTargetIdentityCheckpoint(
      afterNativeState,
      spec,
      targetIdentity,
      "native focus attempt",
      native.foregroundPid === targetPid ? { requireForeground: true } : {}
    )
  );
  if (native.foregroundPid === targetPid) {
    return {
      native,
      manual: { requested: false, acquired: true, timeoutMs: 0 },
      synthetic: { allowed: syntheticFocusAllowed, attempted: false },
      identityCheckpoints,
    };
  }

  console.error(
    `[GameHub overlay QA] Manual focus checkpoint: foreground the selected game within ${manualTimeoutMs} ms. No input will be synthesized.`
  );
  let manual = null;
  try {
    manual = await waitForBoundRenderTargetState(
      "Manual game foreground focus",
      electronApp,
      spec,
      targetIdentity,
      (state) =>
        isBoundRenderTargetState(state, spec, targetIdentity, {
          requireForeground: true,
        }),
      manualTimeoutMs,
      250
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("Manual game foreground focus timed out")
    ) {
      throw error;
    }
  }
  if (manual) {
    identityCheckpoints.push(
      makeRenderTargetIdentityCheckpoint(
        manual,
        spec,
        targetIdentity,
        "manual focus",
        { requireForeground: true }
      )
    );
    return {
      native,
      manual: {
        requested: true,
        acquired: true,
        timeoutMs: manualTimeoutMs,
      },
      synthetic: { allowed: syntheticFocusAllowed, attempted: false },
      identityCheckpoints,
    };
  }

  const attachedQueue = {
    attempted: true,
    synthesizedInput: false,
    ...attachProcessWindowActivationForQa(targetIdentity),
  };
  const afterAttachedQueueState = await readBoundRenderTargetState(
    electronApp,
    targetIdentity
  );
  identityCheckpoints.push(
    makeRenderTargetIdentityCheckpoint(
      afterAttachedQueueState,
      spec,
      targetIdentity,
      "attached-queue focus attempt",
      attachedQueue.activated ? { requireForeground: true } : {}
    )
  );
  if (attachedQueue.activated) {
    return {
      native,
      manual: {
        requested: true,
        acquired: false,
        timeoutMs: manualTimeoutMs,
      },
      attachedQueue,
      synthetic: { allowed: syntheticFocusAllowed, attempted: false },
      identityCheckpoints,
    };
  }

  const synthetic = syntheticFocusAllowed
    ? {
        allowed: true,
        attempted: true,
        ...synthesizeProcessWindowActivationForQa(targetIdentity),
      }
    : { allowed: false, attempted: false, activated: false, exitCode: null };
  ensure(
    synthetic.activated,
    syntheticFocusAllowed
      ? "The explicitly enabled synthetic focus fallback did not foreground the selected game."
      : `The manual and non-synthetic attached-queue focus attempts failed (exit ${attachedQueue.exitCode}). Input synthesis is disabled; set the exact GAMEHUB_QA_SYNTHETIC_FOCUS_ACK only if a balanced Alt key fallback is acceptable.`
  );
  const syntheticForeground = await waitForBoundRenderTargetState(
    "Game foreground focus after explicit synthetic fallback",
    electronApp,
    spec,
    targetIdentity,
    (state) =>
      isBoundRenderTargetState(state, spec, targetIdentity, {
        requireForeground: true,
      }),
    5_000,
    250
  );
  identityCheckpoints.push(
    makeRenderTargetIdentityCheckpoint(
      syntheticForeground,
      spec,
      targetIdentity,
      "synthetic focus fallback",
      { requireForeground: true }
    )
  );
  return {
    native,
    manual: {
      requested: true,
      acquired: false,
      timeoutMs: manualTimeoutMs,
    },
    attachedQueue,
    synthetic,
    identityCheckpoints,
  };
}

async function screenshotElectronWindow(electronApp, kind, filePath) {
  const page = electronApp.windows().find((candidate) => {
    const url = candidate.url();
    if (kind === "overlay") {
      return url.includes("#/overlay") && !url.includes("overlay-toast");
    }
    const toastKind = overlayToastKind(url);
    if (kind === "gate-error") return toastKind === "refusal";
    return toastKind === "ready";
  });
  if (!page || page.isClosed()) return false;
  await page.screenshot({ path: filePath, animations: "disabled" });
  return fs.existsSync(filePath);
}

async function closeValidatedElectronProcess({
  electronApp,
  launchedProcess,
  expectedIdentity,
  expectedExecutablePath,
}) {
  await electronApp?.close().catch(() => undefined);
  const pid = expectedIdentity?.pid ?? launchedProcess?.pid;
  if (!pid) return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(100);
  }
  ensure(
    expectedIdentity &&
      expectedIdentity.pid === pid &&
      path.resolve(expectedIdentity.executablePath).toLowerCase() ===
        path.resolve(expectedExecutablePath).toLowerCase(),
    "Refusing to terminate a QA Electron PID whose identity changed."
  );
  ensure(
    stopExactProcessWithPowerShell(expectedIdentity),
    "The exact QA Electron process could not be terminated."
  );
  await waitFor(
    "Exact QA Electron process cleanup",
    () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    (stillPresent) => !stillPresent,
    5_000,
    100
  );
}

async function main() {
  ensure(process.platform === "win32", "Live overlay QA is Windows-only.");
  const mode = parseLiveOverlayQaMode(process.env.GAMEHUB_QA_LIVE_OVERLAY_MODE);
  const requiredToastEvidence = requiredToastEvidenceForMode(mode);
  if (mode === LIVE_OVERLAY_QA_MODE.expectRefusal) {
    ensure(
      process.env.GAMEHUB_QA_LIVE_OVERLAY_ACK === LIVE_ACKNOWLEDGEMENT,
      "Refusing to launch a game without the exact live-overlay acknowledgement."
    );
  }
  const syntheticFocusAllowed = isSyntheticFocusExplicitlyAllowed(
    process.env.GAMEHUB_QA_SYNTHETIC_FOCUS_ACK
  );
  const manualFocusTimeoutMs =
    mode === LIVE_OVERLAY_QA_MODE.expectRefusal
      ? numericEnvironment(
          "GAMEHUB_QA_MANUAL_FOCUS_TIMEOUT_MS",
          15_000,
          1_000,
          120_000
        )
      : null;
  const targetId = process.env.GAMEHUB_QA_OVERLAY_TARGET?.trim();
  const spec = TARGETS[targetId];
  ensure(spec, "GAMEHUB_QA_OVERLAY_TARGET must be spider-man-2 or khazan.");
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
  ensure(
    fs.existsSync(sourceData) && fs.statSync(sourceData).isDirectory(),
    "GAMEHUB_LIVE_DATA must identify a directory."
  );
  ensure(
    fs.existsSync(playwrightPackage) &&
      fs.statSync(playwrightPackage).isDirectory(),
    "PLAYWRIGHT_PACKAGE must identify a directory."
  );
  const databaseSource = path.join(sourceData, "gamehub-db");
  ensure(
    fs.existsSync(databaseSource) && fs.statSync(databaseSource).isDirectory(),
    "GAMEHUB_LIVE_DATA must contain a gamehub-db directory."
  );
  for (const filePath of [
    spec.executablePath,
    ...spec.trackingExecutablePaths,
  ]) {
    ensure(
      fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
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
      fs.existsSync(required) && fs.statSync(required).isFile(),
      `Required current-build file is missing: ${path.basename(required)}.`
    );
  }
  const builtInputPolicy = inspectBuiltLiveInputPolicy(mainEntry);

  const initialProcesses = listWindowsProcesses();
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
    `An anti-cheat process is already active for ${spec.id}; refusing overlay QA.`
  );

  const runId = new Date().toISOString().replaceAll(/[-:.TZ]/gu, "");
  const artifactRoot = path.join(
    ROOT,
    "artifacts",
    "qa-live-overlay",
    `${runId}-${spec.id}-${mode}`
  );
  const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), CLONE_PREFIX));
  const cloneData = path.join(cloneRoot, "data");
  const report = {
    schemaVersion: 2,
    kind: "gamehub-external-window-normal-launch-overlay-qa",
    runId,
    mode,
    target: spec.id,
    startedAt: new Date().toISOString(),
    executionModel: {
      launchPath: "normal-gamehub-open-game",
      presentationPath: "external-electron-browser-window",
      supervisedLaunch: false,
      inProcessCompositor: false,
      interactiveSuccessExpected: false,
    },
    buildPolicy: builtInputPolicy,
    runtimeIdentity: null,
    processInventory: {
      source: processInventorySource,
      inventoryDegraded: processInventoryDegraded,
    },
    safety: {
      isolatedClone: true,
      credentialsStripped: false,
      cloudSavesDisabled: false,
      originalDatabaseUnchanged: false,
      originalProcessesPreserved: true,
      inventoryDegraded: processInventoryDegraded,
      gameLaunchAttempted: false,
      syntheticFocusAllowed,
    },
    library: null,
    launch: null,
    overlay: null,
    screenshots: [],
    cleanup: {
      gameProcessesRemaining: null,
      electronStopped: false,
      electronProcessesRemaining: null,
      cloneRemoved: false,
    },
    error: null,
    finishedAt: null,
    outcome: "running",
  };
  let databaseHashBefore = null;
  let electronApp = null;
  let electronProcess = null;
  let electronProcessIdentity = null;
  let page = null;
  let game = null;
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
    report.runtimeIdentity = {
      playwrightLauncherPid: electronProcess?.pid ?? null,
      electronMainPid: inspected.electronMainPid ?? null,
      electronMainCreationTimeTicks:
        inspected.electronMainCreationTimeTicks ?? null,
      executablePath: electronExecutable,
    };
    ensure(
      Number.isInteger(electronProcess?.pid) &&
        Number.isInteger(inspected.electronMainPid) &&
        inspected.electronMainPid > 4 &&
        /^\d+$/u.test(inspected.electronMainCreationTimeTicks ?? ""),
      "The QA Electron process did not prove its exact PID and creation identity."
    );
    electronProcessIdentity = await waitFor(
      "Exact QA Electron main-process identity",
      () =>
        listWindowsProcesses().find(
          (item) => item.pid === inspected.electronMainPid
        ) ?? null,
      (item) =>
        Boolean(
          item?.creationDate === inspected.electronMainCreationTimeTicks &&
            item.executablePath &&
            path.resolve(item.executablePath).toLowerCase() ===
              path.resolve(electronExecutable).toLowerCase()
        ),
      5_000,
      100
    );
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
      `${spec.id} is not eligible for guarded local/offline overlay QA.`
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
    if (mode === LIVE_OVERLAY_QA_MODE.preflightOnly) {
      report.launch = {
        attempted: false,
        reason: "preflight-only",
        throughGameHubIpc: false,
      };
      report.overlay = {
        attempted: false,
        outcome: "not-run-preflight-only",
        requiredToastEvidence,
      };
      report.outcome = "preflight-passed";
    } else {
      await mainControl(electronApp, "prepare-target", { game });

      report.safety.gameLaunchAttempted = true;
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
      await mainControl(electronApp, "set-active", { game });
      activeSet = true;

      const renderExecutablePath = expectedRenderExecutablePath(spec);
      const targetReady = await waitFor(
        "GameHub overlay render target",
        () => mainControl(electronApp, "diagnostics"),
        (value) =>
          value.targetPid > 0 &&
          value.targetBounds?.width > 0 &&
          /^\d+$/u.test(value.targetCreationTimeTicks ?? "") &&
          path.resolve(value.targetExecutable ?? "").toLowerCase() ===
            path.resolve(renderExecutablePath).toLowerCase(),
        numericEnvironment(
          "GAMEHUB_QA_GAME_READY_TIMEOUT_MS",
          180_000,
          30_000,
          600_000
        ),
        500
      );
      const targetIdentity = await waitFor(
        "Exact GameHub overlay render-target identity",
        () =>
          listWindowsProcesses().find(
            (item) => item.pid === targetReady.targetPid
          ) ?? null,
        (item) =>
          Boolean(
            item &&
              isExactRenderProcess(item, spec) &&
              item.creationDate === targetReady.targetCreationTimeTicks
          ),
        5_000,
        100
      );
      const targetAcquiredState = {
        diagnostics: targetReady,
        processItem: targetIdentity,
      };
      ensure(
        findGameRootAntiCheatProcesses(listWindowsProcesses(), spec).length ===
          0,
        `A ${spec.id} anti-cheat process appeared after launch; refusing overlay QA.`
      );
      ensure(
        targetReady.recorderState.captureActive === false,
        "The recorder unexpectedly activated during overlay-only QA."
      );
      report.launch = {
        attempted: true,
        throughGameHubIpc: true,
        launchPath: "normal-gamehub-open-game",
        supervisedLaunch: false,
        targetPid: targetReady.targetPid,
        renderExecutable: path.basename(targetReady.targetExecutable),
        targetIdentity: {
          pid: targetIdentity.pid,
          creationTimeTicks: targetIdentity.creationDate,
          executablePath: targetIdentity.executablePath,
        },
        targetWindowDetected: true,
        gameHubElevated: targetReady.gameHubElevated,
        processAccess: targetReady.processAccess,
        injectionRisk: targetReady.injectionRisk,
        identityCheckpoints: [
          makeRenderTargetIdentityCheckpoint(
            targetAcquiredState,
            spec,
            targetIdentity,
            "render-target acquisition",
            { requireBounds: true }
          ),
        ],
      };
      await page
        .evaluate(() => globalThis.window.electron.closeGameLauncherWindow())
        .catch(() => undefined);
      const focusAttempt = await acquireGameForeground({
        electronApp,
        spec,
        targetPid: targetReady.targetPid,
        targetIdentity,
        manualTimeoutMs: manualFocusTimeoutMs,
        syntheticFocusAllowed,
      });
      const { identityCheckpoints: focusIdentityCheckpoints, ...focusReport } =
        focusAttempt;
      report.launch.focusAttempt = focusReport;
      report.launch.identityCheckpoints.push(...focusIdentityCheckpoints);
      const foregroundState = await waitForBoundRenderTargetState(
        "Game foreground focus",
        electronApp,
        spec,
        targetIdentity,
        (state) =>
          isBoundRenderTargetState(state, spec, targetIdentity, {
            requireForeground: true,
            requireBounds: true,
          }),
        8_000,
        250
      );
      const foreground = foregroundState.diagnostics;
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          foregroundState,
          spec,
          targetIdentity,
          "settled foreground focus",
          { requireForeground: true, requireBounds: true }
        )
      );

      const beforeToggleState = await readBoundRenderTargetState(
        electronApp,
        targetIdentity
      );
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          beforeToggleState,
          spec,
          targetIdentity,
          "immediately before explicit toggle",
          { requireForeground: true, requireBounds: true }
        )
      );
      await mainControl(electronApp, "toggle-overlay");
      const toggleState = await waitForBoundRenderTargetState(
        "Overlay visibility or explicit input-gate refusal",
        electronApp,
        spec,
        targetIdentity,
        (state) => {
          const diagnostics = state.diagnostics;
          return (
            Boolean(findOverlayWindow(diagnostics)) ||
            hasRequiredToastEvidence(diagnostics, requiredToastEvidence) ||
            (!diagnostics.overlayTogglePending &&
              (diagnostics.gateReadiness?.reason === "unavailable" ||
                diagnostics.gateReadiness?.reason === "unsupported" ||
                diagnostics.processAccess?.canInject === false ||
                diagnostics.injectionRisk?.safe === false))
          );
        },
        12_000,
        100
      );
      const toggleResult = toggleState.diagnostics;
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          toggleState,
          spec,
          targetIdentity,
          "toggle outcome",
          { requireBounds: true }
        )
      );

      const overlayWindow = findOverlayWindow(toggleResult);
      if (overlayWindow) {
        await mainControl(electronApp, "hide-overlay").catch(() => undefined);
        throw new Error(
          "The interactive external overlay became visible in expect-refusal mode."
        );
      }

      const readiness = toggleResult.gateReadiness;
      const refusal = evaluateExpectedOverlayRefusal({
        mode,
        overlayVisible: false,
        gateReason: readiness?.reason ?? null,
        accessBlocked: toggleResult.processAccess.canInject === false,
        moduleBlocked: toggleResult.injectionRisk.safe === false,
        unsupportedModuleMask:
          toggleResult.gateStatus?.unsupportedModuleMask ?? 0,
        liveInputKillSwitchConfirmed: builtInputPolicy.killSwitchConfirmed,
      });
      ensure(
        refusal.accepted,
        `No accepted safety refusal was proven (${refusal.reason}).`
      );
      ensure(
        toggleResult.gateStatus?.blocked !== true,
        "Expected refusal left the native input latch blocked."
      );
      ensure(
        requiredToastEvidence === "refusal",
        "Expect-refusal mode did not select refusal-toast evidence."
      );
      const toastState = await waitForBoundRenderTargetState(
        "Visible right-edge input-gate refusal notification",
        electronApp,
        spec,
        targetIdentity,
        (state) =>
          isBoundRenderTargetState(state, spec, targetIdentity, {
            requireForeground: true,
            requireBounds: true,
          }) &&
          hasRequiredToastEvidence(state.diagnostics, requiredToastEvidence),
        8_000,
        50
      );
      const toastResult = toastState.diagnostics;
      const gateToast = findInputGateToast(toastResult);
      ensure(
        gateToast,
        "The expected input-gate refusal notification did not appear."
      );
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          toastState,
          spec,
          targetIdentity,
          "required refusal toast",
          { requireForeground: true, requireBounds: true }
        )
      );
      const notificationGeometry = validateRightEdgeToastGeometry(
        gateToast,
        toastResult.targetBounds,
        "refusal"
      );
      const notificationPresentation = await inspectToastPresentation(
        electronApp,
        "gate-error"
      );
      const beforeCaptureState = await readBoundRenderTargetState(
        electronApp,
        targetIdentity
      );
      const beforeCapture = ensureBoundRenderTargetState(
        beforeCaptureState,
        spec,
        targetIdentity,
        "immediately before refusal-toast capture",
        { requireForeground: true, requireBounds: true }
      );
      ensure(
        hasRequiredToastEvidence(beforeCapture, requiredToastEvidence),
        "The required refusal notification disappeared before capture."
      );
      ensure(
        boundsMatch(beforeCapture.targetBounds, toastResult.targetBounds),
        "The target bounds changed before refusal-toast capture."
      );
      validateRightEdgeToastGeometry(
        findInputGateToast(beforeCapture),
        beforeCapture.targetBounds,
        "refusal"
      );
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          beforeCaptureState,
          spec,
          targetIdentity,
          "immediately before refusal-toast capture",
          { requireForeground: true, requireBounds: true }
        )
      );
      const compositePath = path.join(
        artifactRoot,
        `${spec.id}-input-gate-refusal-over-game.png`
      );
      captureDesktopRegion(compositePath, beforeCapture.targetBounds);
      report.screenshots.push(pngEvidence(compositePath));
      const afterCompositeCaptureState = await readBoundRenderTargetState(
        electronApp,
        targetIdentity
      );
      const afterCompositeCapture = ensureBoundRenderTargetState(
        afterCompositeCaptureState,
        spec,
        targetIdentity,
        "immediately after refusal-toast desktop capture",
        { requireForeground: true, requireBounds: true }
      );
      ensure(
        hasRequiredToastEvidence(
          afterCompositeCapture,
          requiredToastEvidence
        ) &&
          boundsMatch(
            afterCompositeCapture.targetBounds,
            beforeCapture.targetBounds
          ),
        "The required refusal notification or target bounds changed during desktop capture."
      );
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          afterCompositeCaptureState,
          spec,
          targetIdentity,
          "immediately after refusal-toast desktop capture",
          { requireForeground: true, requireBounds: true }
        )
      );
      const toastPath = path.join(
        artifactRoot,
        `${spec.id}-input-gate-refusal-window.png`
      );
      ensure(
        await screenshotElectronWindow(electronApp, "gate-error", toastPath),
        "The required refusal notification could not be captured directly."
      );
      report.screenshots.push(pngEvidence(toastPath));
      const afterToastCaptureState = await readBoundRenderTargetState(
        electronApp,
        targetIdentity
      );
      const afterToastCapture = ensureBoundRenderTargetState(
        afterToastCaptureState,
        spec,
        targetIdentity,
        "immediately after direct refusal-toast capture",
        { requireForeground: true, requireBounds: true }
      );
      ensure(
        hasRequiredToastEvidence(afterToastCapture, requiredToastEvidence) &&
          boundsMatch(
            afterToastCapture.targetBounds,
            beforeCapture.targetBounds
          ),
        "The required refusal notification or target bounds changed during direct capture."
      );
      report.launch.identityCheckpoints.push(
        makeRenderTargetIdentityCheckpoint(
          afterToastCaptureState,
          spec,
          targetIdentity,
          "immediately after direct refusal-toast capture",
          { requireForeground: true, requireBounds: true }
        )
      );
      report.overlay = {
        attempted: true,
        outcome: "expected-refusal",
        refusalReason: refusal.reason,
        explicitToggle: true,
        externalWindowOnly: true,
        supervisedLaunch: false,
        inProcessCompositor: false,
        sameIntegrityProcessAccess:
          toggleResult.processAccess.canInject === true,
        processAccessErrorCode: toggleResult.processAccess.errorCode,
        injectionRiskSafe: toggleResult.injectionRisk.safe,
        injectionRiskReason: toggleResult.injectionRisk.reason,
        injectionRiskModule: toggleResult.injectionRisk.moduleName,
        gateReason: readiness?.reason ?? null,
        capabilityMask: toggleResult.gateStatus?.capabilityMask ?? 0,
        unsupportedModuleMask:
          toggleResult.gateStatus?.unsupportedModuleMask ?? 0,
        errorToastVisible: true,
        requiredToastEvidence,
        requiredToastEvidenceObserved: true,
        exactRenderTargetIdentityBoundThroughCapture: true,
        targetBoundsStableThroughCapture: true,
        directToastCaptureRequired: true,
        notificationGeometry,
        notificationPresentation,
      };
      report.outcome = "expected-refusal-observed";

      ensure(
        foreground.targetPid === toggleResult.targetPid,
        "Overlay target changed during the acceptance toggle."
      );
    }
  } catch (error) {
    report.outcome = "failed";
    report.error = sanitizeText(
      error instanceof Error ? (error.stack ?? error.message) : error
    );
  } finally {
    if (report.safety.gameLaunchAttempted && page && game) {
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

    if (report.safety.gameLaunchAttempted) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const remaining = listWindowsProcesses().filter(
          (item) =>
            !initialIdentities.has(processIdentity(item)) && matcher(item)
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
      await closeValidatedElectronProcess({
        electronApp,
        launchedProcess: electronProcess,
        expectedIdentity: electronProcessIdentity,
        expectedExecutablePath: electronExecutable,
      });
      report.cleanup.electronStopped = true;
      report.cleanup.electronProcessesRemaining = listWindowsProcesses().filter(
        (item) =>
          !initialIdentities.has(processIdentity(item)) &&
          item.name === "electron.exe"
      ).length;
      ensure(
        report.cleanup.electronProcessesRemaining === 0,
        "A new Electron process remained after QA cleanup."
      );
    } catch (error) {
      report.error ??= sanitizeText(error);
      report.outcome = "failed";
    }

    try {
      const remaining = listWindowsProcesses().filter(
        (item) => !initialIdentities.has(processIdentity(item)) && matcher(item)
      );
      if (report.safety.gameLaunchAttempted) {
        for (const processItem of remaining) {
          terminateValidatedTargetProcess(processItem, initialIdentities, spec);
        }
        await sleep(750);
      }
      report.cleanup.gameProcessesRemaining = listWindowsProcesses().filter(
        (item) => !initialIdentities.has(processIdentity(item)) && matcher(item)
      ).length;
      if (report.cleanup.gameProcessesRemaining !== 0) {
        report.outcome = "failed";
        report.error ??=
          mode === LIVE_OVERLAY_QA_MODE.preflightOnly
            ? "A target process appeared during preflight; it was not started or terminated by this runner."
            : "A new exact target process remained after cleanup.";
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

    report.processInventory = {
      source: processInventorySource,
      inventoryDegraded: processInventoryDegraded,
    };
    report.safety.inventoryDegraded = processInventoryDegraded;
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

const invokedModuleUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedModuleUrl === import.meta.url) await main();
