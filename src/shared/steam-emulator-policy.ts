import { redactConsoleLogText } from "./console-log";

export interface OfflinePlaySetupGame {
  shop?: string | null;
  objectId?: string | null;
  libraryOrigin?: "sync" | "catalog" | "custom" | undefined;
  executablePath?: string | null;
}

export const getSteamEmulatorRuntimeConfigPath = (userDataPath: string) =>
  `${userDataPath.replace(/[\\/]+$/, "")}\\steam-emulator\\config.json`;

/**
 * The third-party CLI can echo its generated configuration on failures. Keep
 * diagnostics useful, bounded, and safe even if it prints SteamWebAPIKey in a
 * format the generic logger has not seen before.
 */
export const sanitizeSteamEmulatorOutput = (
  output: string,
  maxLength = 4_000
) => {
  const redacted = redactConsoleLogText(output)
    .replace(
      /(\bSteamWebAPIKey\b\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      "$1[redacted]"
    )
    .replace(/\b[a-f\d]{32}\b/gi, "[redacted]");
  return redacted.slice(-Math.max(0, maxLength));
};

/**
 * SteamStub unpacking can rewrite arbitrary game executables. GameHub's
 * offline-play setup only needs the Steam API replacement, so the runtime
 * config always disables executable unpacking before it is persisted.
 */
export const hardenSteamEmulatorRuntimeConfig = <
  T extends { ProcessConfigs?: Record<string, unknown> },
>(
  config: T
): T & { ProcessConfigs: Record<string, unknown> & { Unpack: false } } => ({
  ...config,
  ProcessConfigs: {
    ...(config.ProcessConfigs ?? {}),
    Unpack: false,
  },
});

export type SteamEmulatorSetupAction = "apply" | "ready" | "reject";

export const getSteamEmulatorSetupAction = (
  status: string,
  appId: string
): SteamEmulatorSetupAction => {
  if (!/^\d+$/.test(appId)) return "reject";
  if (status === "emulator-ready") return "ready";
  if (status === "clean") return "apply";
  return "reject";
};

const URI_EXECUTABLE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Offline-play setup is restricted to manually managed local executables.
 * Any URI is delegated to its owning platform client and must never be
 * modified, even when a stale library record is missing its `sync` origin.
 */
export const isOfflinePlaySetupEligible = (game: OfflinePlaySetupGame) => {
  if (game.libraryOrigin !== "catalog" && game.libraryOrigin !== "custom") {
    return false;
  }
  if (game.shop !== "steam") return false;
  if (!/^\d+$/.test(game.objectId ?? "")) return false;
  return !URI_EXECUTABLE_PATTERN.test(game.executablePath?.trim() ?? "");
};

export interface GoldbergAchievementState {
  earned: boolean;
  earned_time: number;
}

/** Convert SteamAutoCrack's achievement schema into gbe_fork save state. */
export const buildGoldbergAchievementState = (
  schema: unknown
): Record<string, GoldbergAchievementState> | null => {
  const names: string[] = [];

  if (Array.isArray(schema)) {
    for (const entry of schema) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { name?: unknown }).name === "string"
      ) {
        names.push((entry as { name: string }).name.trim());
      }
    }
  } else if (schema && typeof schema === "object") {
    names.push(...Object.keys(schema));
  } else {
    return null;
  }

  const state: Record<string, GoldbergAchievementState> = {};
  for (const name of names) {
    if (!name || Object.prototype.hasOwnProperty.call(state, name)) continue;
    state[name] = { earned: false, earned_time: 0 };
  }

  return state;
};
