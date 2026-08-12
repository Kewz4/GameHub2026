import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "../system-path";
import { logger } from "../logger";

/**
 * SteamAutoCrack integration.
 *
 * Bundles the SteamAutoCrack CLI (built from source — the upstream release
 * only ships the GUI) plus the Goldberg emulator bundle (regular +
 * experimental). Detects games that were shipped with clean Steam files and
 * cracks them automatically before launch, then the game restarts with the
 * Goldberg emulator working.
 *
 * Emulator config strategy (matches the achievement watcher's scan paths):
 *   - UseLocalSave = false  → saves land in %APPDATA%\GSE Saves\<appid>\
 *   - UseGoldbergExperimental = true (per user preference)
 *   - SteamWebAPIKey baked in → achievement schema + images generated from
 *     the official Steam Web API at crack time.
 */

const CRACK_TOOL_FOLDER_NAME = "cracktool";
const CRACK_TOOL_EXE_NAME = "SteamAutoCrack.CLI.exe";

/** Goldberg emulator DLL signatures (22MB gbe_fork builds). */
const GBE_EMULATOR_MIN_SIZE_BYTES = 20 * 1024 * 1024;

/** Files that indicate some crack (any flavour) is already present. */
const OTHER_CRACK_SIGNATURES = [
  "steam_emu.ini",
  "steam_settings",
  "SmartSteamEmu.ini",
  "SmartSteamEmu64.ini",
  "cream_api.ini",
  "CreamAPI.ini",
];

export type CrackStatus =
  | "tool-unavailable"
  | "not-installed"
  | "cracked-goldberg"
  | "cracked-other"
  | "clean";

export interface CrackDetection {
  status: CrackStatus;
  /** Short human-readable reason for the status. */
  reason: string;
  /** Absolute path to the game directory that would be cracked. */
  gameDir?: string;
}

export interface CrackResult {
  success: boolean;
  /** Exit code of the CLI process (null if it never spawned). */
  exitCode: number | null;
  /** Tail of the CLI stdout/stderr for debugging. */
  output: string;
}

const getCrackToolDirectory = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, CRACK_TOOL_FOLDER_NAME);
  }
  // Dev: repo root / cracktool (bundled chunks live flat in out/main).
  return path.join(__dirname, "..", "..", CRACK_TOOL_FOLDER_NAME);
};

const getCrackToolExecutable = () =>
  path.join(getCrackToolDirectory(), CRACK_TOOL_EXE_NAME);

export const isCrackToolAvailable = () => {
  try {
    return fs.existsSync(getCrackToolExecutable());
  } catch {
    return false;
  }
};

/** Absolute path to the config.json the CLI is run with. */
const getCrackConfigPath = () =>
  path.join(getCrackToolDirectory(), "config.json");

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
 * files written by newly cracked games.
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
 * Load the crack config, patching in the personal SteamWebAPI key and
 * experimental Goldberg emulator. Generates the file via the CLI when it
 * doesn't exist yet (so the schema always matches the tool's version).
 */
export const ensureCrackConfig = async (): Promise<string | null> => {
  if (!isCrackToolAvailable()) return null;

  const configPath = getCrackConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      logger.log("Generating SteamAutoCrack config");
      await runCrackTool(["createconfig", "--path", configPath]);
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
      logger.log("SteamAutoCrack config patched", { configPath });
    }
  } catch (error) {
    logger.error("Failed to ensure SteamAutoCrack config", error);
    return null;
  }

  return configPath;
};

const runCrackTool = (
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ exitCode: number | null; output: string }> => {
  const executable = getCrackToolExecutable();
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
        cwd: options.cwd ?? getCrackToolDirectory(),
      });
    } catch (error) {
      logger.error("Failed to spawn SteamAutoCrack CLI", error);
      resolve({ exitCode: null, output: String(error) });
      return;
    }

    const timeout = setTimeout(() => {
      logger.warn("SteamAutoCrack CLI timed out", { args });
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
      logger.error("SteamAutoCrack CLI error", error);
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

/**
 * Detect whether a game directory is already cracked, and if so, with what.
 */
export const detectCrackStatus = (gameDir: string): CrackDetection => {
  if (!isCrackToolAvailable()) {
    return {
      status: "tool-unavailable",
      reason: "SteamAutoCrack CLI is not bundled with this build",
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
      status: "cracked-goldberg",
      reason:
        hasRne || hasDllBak
          ? "Goldberg emulator already applied (backup files present)"
          : "Goldberg emulator DLL detected",
      gameDir,
    };
  }

  if (hasAnySignature(gameDir, OTHER_CRACK_SIGNATURES)) {
    return {
      status: "cracked-other",
      reason: "Another emulator signature is present (skipping auto-crack)",
      gameDir,
    };
  }

  return {
    status: "clean",
    reason: "No emulator signature detected — clean Steam files",
    gameDir,
  };
};

/**
 * Run SteamAutoCrack on a game directory. Uses the bundled experimental
 * Goldberg emulator and the personal SteamWebAPI key (via config.json).
 */
export const crackGame = async (
  gameDir: string,
  appId: string
): Promise<CrackResult> => {
  const configPath = await ensureCrackConfig();
  if (!configPath) {
    return {
      success: false,
      exitCode: null,
      output: "SteamAutoCrack CLI or config unavailable",
    };
  }

  ensureGoldbergSaveFolders();

  logger.log("Cracking game with SteamAutoCrack", { gameDir, appId });

  const result = await runCrackTool([
    "crack",
    gameDir,
    "--config",
    configPath,
    "--appid",
    appId,
  ]);

  // Validate the result: after a successful crack the emulator DLL is huge
  // (or backup files exist).
  const detection = detectCrackStatus(gameDir);
  const success =
    result.exitCode === 0 && detection.status === "cracked-goldberg";

  logger.log("SteamAutoCrack result", {
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
 * Auto-crack flow used at launch time: crack if clean, skip if already
 * cracked, refuse if a different crack is present.
 */
export const ensureGoldbergCracked = async (
  gameDir: string,
  appId: string
): Promise<CrackDetection> => {
  const detection = detectCrackStatus(gameDir);

  if (detection.status === "clean") {
    const result = await crackGame(gameDir, appId);
    if (!result.success) {
      logger.error("SteamAutoCrack failed", {
        gameDir,
        output: result.output,
      });
    }
    return detectCrackStatus(gameDir);
  }

  return detection;
};
