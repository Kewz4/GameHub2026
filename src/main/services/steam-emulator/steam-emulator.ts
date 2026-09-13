import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "../system-path";
import { logger } from "../logger";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import {
  buildGoldbergAchievementState,
  getSteamEmulatorRuntimeConfigPath,
  getSteamEmulatorSetupAction,
  hardenSteamEmulatorRuntimeConfig,
  sanitizeSteamEmulatorOutput,
} from "@shared";
import { getWindowsRoamingAppData } from "../windows-roaming-app-data";
import {
  runProcessWithTreeTimeout,
  SerializedOperationQueue,
} from "./steam-emulator-process";
import { resolveSafeSteamEmulatorDirectory } from "./steam-emulator-target";
import {
  markSteamEmulatorRecoveryApplied,
  markSteamEmulatorRollbackIncomplete,
  prepareSteamEmulatorRecoveryBackup,
  rollbackSteamEmulatorMutation,
} from "./steam-emulator-transaction";

export { isOfflinePlaySetupEligible } from "@shared";

/**
 * Steam emulator integration.
 *
 * Bundles the SteamAutoCrack CLI (built from source — the upstream release
 * only ships the GUI) plus the Goldberg Steam emulator bundle (regular +
 * experimental). Games that ship with untouched Steam files are set up
 * automatically for offline play before launch (the Steam emulator is
 * applied, then the game runs standalone without the Steam client).
 *
 * Emulator config strategy (matches the achievement watcher's scan paths):
 *   - UseLocalSave = false  → saves land in %APPDATA%\GSE Saves\<appid>\
 *   - UseGoldbergExperimental = true (per user preference)
 *   - SteamWebAPIKey comes from Settings or an explicit runtime environment
 *     value and is written only to the user's writable data directory.
 */

const EMULATOR_TOOL_FOLDER_NAME = "emulator-tool";
const EMULATOR_TOOL_EXE_NAME = "SteamAutoCrack.CLI.exe";

/** Goldberg emulator DLL signatures (22MB gbe_fork builds). */
const GBE_EMULATOR_MIN_SIZE_BYTES = 20 * 1024 * 1024;

/** Files that indicate some Steam emulator (any flavour) is already present. */
const OTHER_EMULATOR_SIGNATURES = [
  "steam_emu.ini",
  "steam_settings",
  "SmartSteamEmu.ini",
  "SmartSteamEmu64.ini",
  "cream_api.ini",
  "CreamAPI.ini",
];

export type SteamEmulatorStatus =
  | "tool-unavailable"
  | "not-installed"
  | "emulator-ready"
  | "emulator-present"
  | "clean";

export interface SteamEmulatorDetection {
  status: SteamEmulatorStatus;
  /** Short human-readable reason for the status. */
  reason: string;
  /** Absolute path to the game directory that would be set up. */
  gameDir?: string;
}

export interface SteamEmulatorResult {
  success: boolean;
  /** Exit code of the CLI process (null if it never spawned). */
  exitCode: number | null;
  /** Tail of the CLI stdout/stderr for debugging. */
  output: string;
  mutationAttempted?: boolean;
  rollbackComplete?: boolean;
  recoveryAvailable?: boolean;
}

export class SteamEmulatorSetupError extends Error {
  readonly code = "STEAM_EMULATOR_SETUP_FAILED";

  constructor(readonly result: SteamEmulatorResult) {
    super(result.output || "Steam emulator setup failed");
    this.name = "SteamEmulatorSetupError";
  }
}

const getEmulatorToolDirectory = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, EMULATOR_TOOL_FOLDER_NAME);
  }
  // Dev: repo root / emulator-tool (bundled chunks live flat in out/main).
  return path.join(__dirname, "..", "..", EMULATOR_TOOL_FOLDER_NAME);
};

const getEmulatorToolExecutable = () =>
  path.join(getEmulatorToolDirectory(), EMULATOR_TOOL_EXE_NAME);

export const isEmulatorToolAvailable = () => {
  try {
    return fs.existsSync(getEmulatorToolExecutable());
  } catch {
    return false;
  }
};

/** Legacy dev/upgrade config. Release packages explicitly exclude this file. */
const getLegacyEmulatorToolConfigPath = () =>
  path.join(getEmulatorToolDirectory(), "config.json");

/** Writable runtime config used by the CLI. Never stored under resources. */
const getEmulatorToolConfigPath = () =>
  getSteamEmulatorRuntimeConfigPath(app.getPath("userData"));

const getDefaultUserPreferencesPath = () => {
  const appData =
    process.platform === "win32"
      ? getWindowsRoamingAppData()
      : SystemPath.getPath("appData");
  return {
    gseSaves: path.join(appData, "GSE Saves"),
    goldbergSaves: path.join(appData, "Goldberg SteamEmu Saves"),
  };
};

/**
 * Ensure the global Goldberg save folders exist so the achievement watcher
 * (which polls GSE Saves / Goldberg SteamEmu Saves every 2s) immediately sees
 * files written by newly set up games.
 */
export const ensureGoldbergSaveFolders = () => {
  const { gseSaves, goldbergSaves } = getDefaultUserPreferencesPath();
  for (const folder of [gseSaves, goldbergSaves]) {
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch {
      // Best effort — the emulator creates it on first run anyway.
    }
  }
};

interface SteamAutoCrackConfig {
  EMUApplyConfigs: {
    LocalSave: string;
    UseLocalSave: boolean;
    UseGoldbergExperimental: boolean;
    GenerateInterfacesFile: boolean;
    ForceGenerateInterfacesFiles: boolean;
  };
  EMUConfigs: Record<string, unknown>;
  SteamStubUnpackerConfigs: Record<string, unknown>;
  EMUGameInfoConfigs: {
    GameInfoAPI: number;
    SteamWebAPIKey: string;
    GenerateImages: boolean;
    UseXan105API: boolean;
    UseSteamWebAppList: boolean;
  };
  GenCrackOnlyConfigs: Record<string, unknown>;
  ProcessConfigs: Record<string, unknown>;
  EnableDebugLog: boolean;
  LogToFile: boolean;
  Language: number;
}

const resolveSteamWebApiKey = async (
  existingKey: unknown,
  legacyKey: unknown
) => {
  const runtimeKey = process.env.GAMEHUB_STEAM_WEB_API_KEY?.trim();
  if (runtimeKey) return runtimeKey;

  const preferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
  const preferenceKey = preferences?.steamApiKey?.trim();
  if (preferenceKey) return preferenceKey;

  // Keep a locally generated/gitignored config usable for standalone smoke
  // tests and upgrades. The key is never copied into tracked source or logs.
  if (typeof existingKey === "string" && existingKey.trim()) {
    return existingKey.trim();
  }

  if (typeof legacyKey === "string" && legacyKey.trim()) {
    return legacyKey.trim();
  }

  return null;
};

/**
 * SteamAutoCrack uses one config file and one TEMP workspace. Serialize every
 * invocation globally so different games, post-install work, and menu clicks
 * cannot corrupt each other's generated metadata.
 */
const steamEmulatorToolQueue = new SerializedOperationQueue();
let steamEmulatorToolQuarantine: string | null = null;

const withSteamEmulatorToolLock = <T>(operation: () => Promise<T>) =>
  steamEmulatorToolQueue.run(operation);

/**
 * Load the emulator config, patching in the user's Steam Web API key and the
 * experimental Goldberg emulator. Generates the file via the CLI when it
 * doesn't exist yet (so the schema always matches the tool's version).
 */
const ensureEmulatorToolConfigUnlocked = async (): Promise<string | null> => {
  if (!isEmulatorToolAvailable()) return null;

  const configPath = getEmulatorToolConfigPath();

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    let legacyKey: unknown;
    const legacyConfigPath = getLegacyEmulatorToolConfigPath();
    if (fs.existsSync(legacyConfigPath)) {
      try {
        const legacyConfig = JSON.parse(
          fs.readFileSync(legacyConfigPath, "utf8")
        ) as Partial<SteamAutoCrackConfig>;
        legacyKey = legacyConfig.EMUGameInfoConfigs?.SteamWebAPIKey;
      } catch {
        // Ignore malformed legacy config; runtime generation still proceeds.
      }
    }

    if (!fs.existsSync(configPath)) {
      logger.log("Generating Steam emulator config");
      const generated = await runEmulatorToolUnlocked([
        "createconfig",
        "--path",
        configPath,
      ]);
      if (generated.exitCode !== 0 || !fs.existsSync(configPath)) {
        logger.error("Failed to generate Steam emulator config", {
          exitCode: generated.exitCode,
        });
        return null;
      }
    }

    let config = JSON.parse(
      fs.readFileSync(configPath, "utf8")
    ) as SteamAutoCrackConfig;

    const steamWebApiKey = await resolveSteamWebApiKey(
      config.EMUGameInfoConfigs?.SteamWebAPIKey,
      legacyKey
    );
    if (!steamWebApiKey) {
      logger.warn(
        "Steam emulator achievement metadata unavailable: add a Steam Web API key in Settings"
      );
      return null;
    }

    let changed = false;
    if (
      config.EMUGameInfoConfigs?.SteamWebAPIKey !== steamWebApiKey ||
      config.EMUGameInfoConfigs?.GenerateImages !== true
    ) {
      config.EMUGameInfoConfigs = {
        ...(config.EMUGameInfoConfigs ?? {}),
        SteamWebAPIKey: steamWebApiKey,
        GenerateImages: true,
      };
      changed = true;
    }
    if (!config.EMUApplyConfigs?.UseGoldbergExperimental) {
      config.EMUApplyConfigs = {
        ...(config.EMUApplyConfigs ?? {}),
        UseGoldbergExperimental: true,
        UseLocalSave: false,
      };
      changed = true;
    }
    if (config.EMUApplyConfigs?.UseLocalSave) {
      config.EMUApplyConfigs.UseLocalSave = false;
      changed = true;
    }
    if (config.ProcessConfigs?.Unpack !== false) {
      config = hardenSteamEmulatorRuntimeConfig(config);
      changed = true;
    }

    if (changed) {
      const temporaryPath = `${configPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), "utf8");
      fs.renameSync(temporaryPath, configPath);
      logger.log("Steam emulator runtime config updated");
    }
  } catch (error) {
    logger.error("Failed to ensure Steam emulator config", error);
    return null;
  }

  return configPath;
};

const runEmulatorToolUnlocked = (
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ exitCode: number | null; output: string }> => {
  if (steamEmulatorToolQuarantine) {
    return Promise.resolve({
      exitCode: null,
      output: steamEmulatorToolQuarantine,
    });
  }

  return runProcessWithTreeTimeout({
    executable: getEmulatorToolExecutable(),
    args,
    cwd: options.cwd ?? getEmulatorToolDirectory(),
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
    sanitizeOutput: sanitizeSteamEmulatorOutput,
    onTimeout: () =>
      logger.warn("Steam emulator CLI timed out", { command: args[0] }),
    onError: (error) => logger.error("Steam emulator CLI error", error),
  }).then((result) => {
    if (result.terminationVerified === false) {
      steamEmulatorToolQuarantine =
        "Steam emulator tool was disabled until GameHub restarts because a timed-out process tree could not be verified as stopped";
      return {
        exitCode: null,
        output: steamEmulatorToolQuarantine,
      };
    }
    return result;
  });
};

export const ensureEmulatorToolConfig = (): Promise<string | null> =>
  withSteamEmulatorToolLock(ensureEmulatorToolConfigUnlocked);

interface SteamEmulatorArtifacts {
  readyByBackup: boolean;
  readyByDll: boolean;
  otherEmulatorPresent: boolean;
}

/**
 * Steam DLLs commonly live below the executable directory (bin/win64, Engine,
 * etc.). Scan a bounded directory tree so those games do not stay permanently
 * `clean` after the CLI applied Goldberg below the root.
 */
const findSteamEmulatorArtifacts = (
  gameDir: string
): SteamEmulatorArtifacts => {
  const result: SteamEmulatorArtifacts = {
    readyByBackup: false,
    readyByDll: false,
    otherEmulatorPresent: false,
  };
  const signatureNames = new Set(
    OTHER_EMULATOR_SIGNATURES.map((value) => value.toLowerCase())
  );
  const pending: Array<{ directory: string; depth: number }> = [
    { directory: gameDir, depth: 0 },
  ];
  let visitedEntries = 0;

  while (pending.length && visitedEntries < 25_000) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries >= 25_000) break;

      const name = entry.name.toLowerCase();
      const fullPath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (signatureNames.has(name)) result.otherEmulatorPresent = true;
        if (current.depth < 8) {
          pending.push({ directory: fullPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;

      if (
        name === "steam_api64.rne" ||
        name === "steam_api.rne" ||
        name === "steam_api64.dll.bak" ||
        name === "steam_api.dll.bak"
      ) {
        result.readyByBackup = true;
      } else if (name === "steam_api64.dll" || name === "steam_api.dll") {
        try {
          if (fs.statSync(fullPath).size >= GBE_EMULATOR_MIN_SIZE_BYTES) {
            result.readyByDll = true;
          }
        } catch {
          // File disappeared during the scan; the next poll can retry.
        }
      }

      if (signatureNames.has(name)) result.otherEmulatorPresent = true;
      if (result.readyByBackup || result.readyByDll) return result;
    }
  }

  return result;
};

const findGeneratedAchievementSchema = (gameDir: string): string | null => {
  const pending: Array<{ directory: string; depth: number }> = [
    { directory: gameDir, depth: 0 },
  ];
  let visitedEntries = 0;

  while (pending.length && visitedEntries < 25_000) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntries += 1;
      const fullPath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 8) {
        pending.push({ directory: fullPath, depth: current.depth + 1 });
      } else if (
        entry.isFile() &&
        entry.name.toLowerCase() === "achievements.json" &&
        path.basename(current.directory).toLowerCase() === "steam_settings"
      ) {
        return fullPath;
      }
    }
  }

  return null;
};

/**
 * Seed gbe_fork's global achievement state immediately after setup. The CLI
 * generates the schema and images, but gbe_fork normally waits for first game
 * launch to create this save file. Seeding it lets GameHub's watcher discover
 * the title at once. Existing progress is never overwritten.
 */
export const ensureGoldbergAchievementState = (
  gameDir: string,
  appId: string
): boolean => {
  if (!/^\d+$/.test(appId)) return false;

  const schemaPath = findGeneratedAchievementSchema(gameDir);
  if (!schemaPath) return false;

  const targetDirectory = path.join(
    getDefaultUserPreferencesPath().gseSaves,
    appId
  );
  const targetPath = path.join(targetDirectory, "achievements.json");
  if (fs.existsSync(targetPath)) return true;

  try {
    const state = buildGoldbergAchievementState(
      JSON.parse(fs.readFileSync(schemaPath, "utf8"))
    );
    if (!state) return false;

    fs.mkdirSync(targetDirectory, { recursive: true });
    const temporaryPath = path.join(
      targetDirectory,
      `.achievements.${process.pid}.${Date.now()}.tmp`
    );
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });

    try {
      // A same-directory hard link is an atomic, exclusive publication: an
      // achievement file created by the game between our checks wins, and is
      // never replaced by the empty seed state.
      fs.linkSync(temporaryPath, targetPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        return true;
      }
      throw error;
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
    return true;
  } catch (error) {
    logger.warn("Failed to seed Goldberg achievement state", error);
    return false;
  }
};

/**
 * Detect whether a game directory already has a Steam emulator applied,
 * and if so, which one.
 */
export const detectSteamEmulatorStatus = (
  gameDir: string
): SteamEmulatorDetection => {
  if (!isEmulatorToolAvailable()) {
    return {
      status: "tool-unavailable",
      reason: "Steam emulator CLI is not bundled with this build",
      gameDir,
    };
  }

  if (!fs.existsSync(gameDir)) {
    return {
      status: "not-installed",
      reason: "Game directory not found",
      gameDir,
    };
  }

  const artifacts = findSteamEmulatorArtifacts(gameDir);
  if (artifacts.readyByBackup || artifacts.readyByDll) {
    return {
      status: "emulator-ready",
      reason: artifacts.readyByBackup
        ? "Goldberg emulator already applied (backup files present)"
        : "Goldberg emulator DLL detected",
      gameDir,
    };
  }

  if (artifacts.otherEmulatorPresent) {
    return {
      status: "emulator-present",
      reason:
        "Another emulator signature is present (skipping offline-play setup)",
      gameDir,
    };
  }

  return {
    status: "clean",
    reason: "No emulator signature detected — untouched Steam files",
    gameDir,
  };
};

/**
 * Run SteamAutoCrack on a game directory. Uses the bundled experimental
 * Goldberg emulator and the user's Steam Web API key (via config.json).
 */
const activeSetups = new Map<string, Promise<SteamEmulatorResult>>();

const getSetupKey = (gameDir: string, appId: string) => {
  return `${path.resolve(gameDir).toLowerCase()}\0${appId}`;
};

const applySteamEmulatorInternal = async (
  inspection: Awaited<ReturnType<typeof resolveSafeSteamEmulatorDirectory>>,
  appId: string,
  additionalBlockedRoots: string[]
): Promise<SteamEmulatorResult> => {
  if (!inspection.ok || !inspection.gameDir) {
    return {
      success: false,
      exitCode: null,
      output: `Steam emulator setup refused: ${inspection.reason}`,
    };
  }
  const gameDir = inspection.gameDir;
  const initialDetection = detectSteamEmulatorStatus(gameDir);
  const action = getSteamEmulatorSetupAction(initialDetection.status, appId);

  if (action === "ready") {
    ensureGoldbergAchievementState(gameDir, appId);
    return {
      success: true,
      exitCode: 0,
      output: "Steam emulator is already ready",
    };
  }

  if (action === "reject") {
    return {
      success: false,
      exitCode: null,
      output: `Steam emulator setup refused: ${initialDetection.reason}`,
    };
  }

  return withSteamEmulatorToolLock(async () => {
    if (steamEmulatorToolQuarantine) {
      return {
        success: false,
        exitCode: null,
        output: steamEmulatorToolQuarantine,
      };
    }

    const lockedInspection = await resolveSafeSteamEmulatorDirectory(
      gameDir,
      additionalBlockedRoots
    );
    if (!lockedInspection.ok || !lockedInspection.gameDir) {
      return {
        success: false,
        exitCode: null,
        output: `Steam emulator setup refused: ${lockedInspection.reason}`,
      };
    }

    // A different queued setup may have completed while this operation waited
    // for the shared CLI workspace. Re-evaluate before touching the game.
    const lockedDetection = detectSteamEmulatorStatus(gameDir);
    const lockedAction = getSteamEmulatorSetupAction(
      lockedDetection.status,
      appId
    );
    if (lockedAction === "ready") {
      ensureGoldbergAchievementState(gameDir, appId);
      return {
        success: true,
        exitCode: 0,
        output: "Steam emulator is already ready",
      };
    }
    if (lockedAction === "reject") {
      return {
        success: false,
        exitCode: null,
        output: `Steam emulator setup refused: ${lockedDetection.reason}`,
      };
    }

    const configPath = await ensureEmulatorToolConfigUnlocked();
    if (!configPath) {
      return {
        success: false,
        exitCode: null,
        output: "Steam emulator CLI or config unavailable",
      };
    }

    ensureGoldbergSaveFolders();

    let recovery;
    try {
      recovery = await prepareSteamEmulatorRecoveryBackup(
        lockedInspection.gameDir,
        appId,
        lockedInspection.steamApiDllPaths,
        lockedInspection.artifactPaths
      );
    } catch (error) {
      return {
        success: false,
        exitCode: null,
        output: sanitizeSteamEmulatorOutput(
          `Steam emulator setup refused: recovery backup failed: ${String(error)}`
        ),
      };
    }

    logger.log("Setting up offline play with Steam emulator", {
      gameDir,
      appId,
    });

    const result = await runEmulatorToolUnlocked([
      "crack",
      gameDir,
      "--config",
      configPath,
      "--appid",
      appId,
    ]);

    // Validate the result: after a successful setup the emulator DLL is huge
    // (or backup files exist).
    const detection = detectSteamEmulatorStatus(gameDir);
    const success =
      result.exitCode === 0 && detection.status === "emulator-ready";
    const achievementsSeeded = success
      ? ensureGoldbergAchievementState(gameDir, appId)
      : false;

    logger.log("Steam emulator setup result", {
      gameDir,
      exitCode: result.exitCode,
      success,
      detection: detection.status,
      achievementsSeeded,
    });

    if (!success) {
      let rollback;
      try {
        rollback = await rollbackSteamEmulatorMutation(
          recovery,
          result.output || `CLI exited with ${String(result.exitCode)}`,
          additionalBlockedRoots
        );
      } catch (error) {
        const rollbackReason = sanitizeSteamEmulatorOutput(String(error));
        await markSteamEmulatorRollbackIncomplete(
          recovery,
          rollbackReason
        ).catch(() => undefined);
        rollback = {
          complete: false,
          reason: `Steam emulator rollback failed: ${rollbackReason}`,
        };
      }

      return {
        success: false,
        exitCode: result.exitCode,
        output: sanitizeSteamEmulatorOutput(
          `${result.output}\n${rollback.reason}`
        ),
        mutationAttempted: true,
        rollbackComplete: rollback.complete,
        recoveryAvailable: true,
      };
    }

    try {
      await markSteamEmulatorRecoveryApplied(recovery);
    } catch (error) {
      const finalizationReason = sanitizeSteamEmulatorOutput(
        `Recovery manifest finalization failed: ${String(error)}`
      );
      let rollback;
      try {
        rollback = await rollbackSteamEmulatorMutation(
          recovery,
          finalizationReason,
          additionalBlockedRoots
        );
      } catch (rollbackError) {
        const rollbackReason = sanitizeSteamEmulatorOutput(
          String(rollbackError)
        );
        await markSteamEmulatorRollbackIncomplete(
          recovery,
          rollbackReason
        ).catch(() => undefined);
        rollback = {
          complete: false,
          reason: `Steam emulator rollback failed: ${rollbackReason}`,
        };
      }
      return {
        success: false,
        exitCode: result.exitCode,
        output: sanitizeSteamEmulatorOutput(
          `${finalizationReason}\n${rollback.reason}`
        ),
        mutationAttempted: true,
        rollbackComplete: rollback.complete,
        recoveryAvailable: true,
      };
    }

    return {
      success,
      exitCode: result.exitCode,
      output: result.output,
      mutationAttempted: true,
      recoveryAvailable: true,
    };
  });
};

/** Idempotent, coalesced entry point for UI, install, and pre-launch callers. */
export const applySteamEmulator = async (
  gameDir: string,
  appId: string,
  additionalBlockedRoots: string[] = [
    process.resourcesPath,
    app.getAppPath(),
    app.getPath("userData"),
  ]
): Promise<SteamEmulatorResult> => {
  if (!/^\d+$/.test(appId)) {
    return {
      success: false,
      exitCode: null,
      output: "Steam emulator setup requires a numeric Steam app id",
    };
  }

  const inspection = await resolveSafeSteamEmulatorDirectory(
    gameDir,
    additionalBlockedRoots
  );
  if (!inspection.ok || !inspection.gameDir) {
    return {
      success: false,
      exitCode: null,
      output: `Steam emulator setup refused: ${inspection.reason}`,
    };
  }

  const key = getSetupKey(inspection.gameDir, appId);
  const active = activeSetups.get(key);
  if (active) return active;

  const operation = applySteamEmulatorInternal(
    inspection,
    appId,
    additionalBlockedRoots
  );
  activeSetups.set(key, operation);
  const clearActiveSetup = () => {
    if (activeSetups.get(key) === operation) activeSetups.delete(key);
  };
  void operation.then(clearActiveSetup, clearActiveSetup);
  return operation;
};

/**
 * Offline-play setup flow used at launch time: apply the emulator if the
 * files are clean, skip if it is already applied, refuse if a different
 * emulator is present.
 */
export const ensureSteamEmulatorReady = async (
  gameDir: string,
  appId: string
): Promise<SteamEmulatorDetection> => {
  const detection = detectSteamEmulatorStatus(gameDir);

  if (detection.status === "clean") {
    const result = await applySteamEmulator(gameDir, appId);
    if (!result.success) {
      logger.error("Steam emulator setup failed", {
        gameDir,
        output: result.output,
      });
      if (result.mutationAttempted) {
        throw new SteamEmulatorSetupError(result);
      }
    }
    return detectSteamEmulatorStatus(gameDir);
  }

  if (detection.status === "emulator-ready") {
    ensureGoldbergAchievementState(gameDir, appId);
  }

  return detection;
};
