import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "../system-path";
import { logger } from "../logger";

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
 *   - SteamWebAPIKey baked in → achievement schema + images generated from
 *     the official Steam Web API at setup time.
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

/** Absolute path to the config.json the CLI is run with. */
const getEmulatorToolConfigPath = () =>
  path.join(getEmulatorToolDirectory(), "config.json");

/**
 * The bundled SteamWebAPI key, used when generating achievement schemas from
 * the official Steam Web API (personal-use key — see SteamAutoCrack's
 * EMUGameInfoConfigs.SteamWebAPIKey).
 */
const STEAM_WEB_API_KEY = "4BAC786A8EB1A7CE6EA2EFE3E174ED2F";

const getDefaultUserPreferencesPath = () => {
  const appData = SystemPath.getPath("appData");
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

/**
 * Load the emulator config, patching in the personal SteamWebAPI key and
 * experimental Goldberg emulator. Generates the file via the CLI when it
 * doesn't exist yet (so the schema always matches the tool's version).
 */
export const ensureEmulatorToolConfig = async (): Promise<string | null> => {
  if (!isEmulatorToolAvailable()) return null;

  const configPath = getEmulatorToolConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      logger.log("Generating Steam emulator config");
      await runEmulatorTool(["createconfig", "--path", configPath]);
    }

    const config = JSON.parse(
      fs.readFileSync(configPath, "utf8")
    ) as SteamAutoCrackConfig;

    let changed = false;
    if (config.EMUGameInfoConfigs?.SteamWebAPIKey !== STEAM_WEB_API_KEY) {
      config.EMUGameInfoConfigs = {
        ...(config.EMUGameInfoConfigs ?? {}),
        SteamWebAPIKey: STEAM_WEB_API_KEY,
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

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      logger.log("Steam emulator config patched", { configPath });
    }
  } catch (error) {
    logger.error("Failed to ensure Steam emulator config", error);
    return null;
  }

  return configPath;
};

const runEmulatorTool = (
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ exitCode: number | null; output: string }> => {
  const executable = getEmulatorToolExecutable();
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return new Promise((resolve) => {
    let output = "";
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, output: output.slice(-4000) });
    };

    let child;
    try {
      child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.cwd ?? getEmulatorToolDirectory(),
      });
    } catch (error) {
      logger.error("Failed to spawn Steam emulator CLI", error);
      resolve({ exitCode: null, output: String(error) });
      return;
    }

    const timeout = setTimeout(() => {
      logger.warn("Steam emulator CLI timed out", { args });
      try {
        child.kill();
      } catch {
        // Ignore races.
      }
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      logger.error("Steam emulator CLI error", error);
      finish(null);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      finish(code);
    });
  });
};

const hasAnySignature = (gameDir: string, signatures: string[]) => {
  for (const signature of signatures) {
    if (fs.existsSync(path.join(gameDir, signature))) return true;
  }
  return false;
};

const getSteamApiDllSize = (gameDir: string): number | null => {
  const dllPath = path.join(gameDir, "steam_api64.dll");
  try {
    return fs.statSync(dllPath).size;
  } catch {
    return null;
  }
};

/** Platform URI exe schemes that ONLY a platform sync handler ever writes. */
const PLATFORM_URI_SCHEMES = [
  "steam://",
  "legendary://",
  "goggalaxy://",
  "goglauncher://",
];

/**
 * Offline-play setup is only for manually added games: custom games and
 * repacks (Retigga). Library-synced games are owned platform installs and
 * must never be modified.
 */
export const isOfflinePlaySetupEligible = (game: {
  libraryOrigin?: "sync" | "catalog" | "custom" | undefined;
  executablePath?: string | null;
}) => {
  if (game.libraryOrigin === "sync") return false;
  const exe = game.executablePath?.toLowerCase() ?? "";
  return !PLATFORM_URI_SCHEMES.some((scheme) => exe.startsWith(scheme));
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

  // Any .rne / .bak files next to the dll mean an emulator was applied before.
  const dllSize = getSteamApiDllSize(gameDir);
  const hasRne = fs.existsSync(path.join(gameDir, "steam_api64.rne"));
  const hasDllBak = fs.existsSync(path.join(gameDir, "steam_api64.dll.bak"));

  if (
    hasRne ||
    hasDllBak ||
    (dllSize !== null && dllSize >= GBE_EMULATOR_MIN_SIZE_BYTES)
  ) {
    return {
      status: "emulator-ready",
      reason:
        hasRne || hasDllBak
          ? "Goldberg emulator already applied (backup files present)"
          : "Goldberg emulator DLL detected",
      gameDir,
    };
  }

  if (hasAnySignature(gameDir, OTHER_EMULATOR_SIGNATURES)) {
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
 * Goldberg emulator and the personal SteamWebAPI key (via config.json).
 */
export const applySteamEmulator = async (
  gameDir: string,
  appId: string
): Promise<SteamEmulatorResult> => {
  const configPath = await ensureEmulatorToolConfig();
  if (!configPath) {
    return {
      success: false,
      exitCode: null,
      output: "Steam emulator CLI or config unavailable",
    };
  }

  ensureGoldbergSaveFolders();

  logger.log("Setting up offline play with Steam emulator", { gameDir, appId });

  const result = await runEmulatorTool([
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

  logger.log("Steam emulator setup result", {
    gameDir,
    exitCode: result.exitCode,
    success,
    detection: detection.status,
  });

  return {
    success,
    exitCode: result.exitCode,
    output: result.output,
  };
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
    }
    return detectSteamEmulatorStatus(gameDir);
  }

  return detection;
};
