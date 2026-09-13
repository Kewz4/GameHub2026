import path from "node:path";

import type { GameShop } from "@types";
import type { ProcessPayload } from "./download/types";

export const EXTERNAL_LAUNCH_TIMEOUT_MS = 2 * 60 * 1000;
export const EXTERNAL_PROCESS_HANDOFF_GRACE_MS = 10_000;

const MIN_GAME_WINDOW_WIDTH = 400;
const MIN_GAME_WINDOW_HEIGHT = 240;

const KNOWN_STORE_OR_SYSTEM_PROCESS =
  /^(?:steam|steamservice|steamwebhelper|gameoverlayui|galaxyclient(?:service|helper)?|galaxycommunication|epicgameslauncher|epicwebhelper|battle\.net|blizzardbrowser|agent|ubisoftconnect|upc|uplay|origin|originwebhelperservice|eadesktop|eabackgroundservice|riotclient(?:services|ux|uxrender)?|xboxpcapp|gamingservices|gamebar|applicationframehost|explorer|rundll32|cmd|conhost|powershell|pwsh|msiexec)(?:\.exe)?$/i;
const AUXILIARY_PROCESS =
  /(?:crash(?:handler|reporter)|easyanticheat|battleye|beservice|(?:launcher|bootstrap|helper|service|updater?|patcher|installer)\d*$|(?:^|[-_.\s])(?:launcher|bootstrap|helper|service|client|overlay|updater?|patcher|installer|uninstall|setup|crash|reporter|eac|anticheat)(?:$|[-_.\s\d]))/i;
const TITLE_STOP_WORDS = new Set([
  "and",
  "edition",
  "for",
  "game",
  "the",
  "with",
]);

export type ExternalGameProcess = Pick<ProcessPayload, "exe" | "name" | "pid">;

export interface ExternalGameLaunchState {
  gameKey: string;
  objectId: string;
  shop: GameShop;
  title: string;
  protocolUrl: string;
  cloudSaveSessionToken: string | null;
  baselinePids: ReadonlySet<number>;
  baselineForegroundPid: number;
  baselineCaptured: boolean;
  startedAt: number;
  phase: "pending" | "bound";
  boundPid: number | null;
  boundExecutablePath: string | null;
  lastSeenAt: number;
  observedCandidatePid: number | null;
  observedCandidateCount: number;
}

export interface ExternalProcessWindow {
  width: number;
  height: number;
}

export interface ExternalProcessMatch {
  process: ExternalGameProcess;
  confidence: "foreground" | "title" | "stable-visible";
}

type ExecutableTrackedGame = {
  executablePath?: string | null;
  nativeExecutablePath?: string | null;
};

type GameWithDiscoveredExecutable<T extends ExecutableTrackedGame> = Omit<
  T,
  keyof ExecutableTrackedGame
> &
  ExecutableTrackedGame;

const launches = new Map<string, ExternalGameLaunchState>();

const basename = (value: string) =>
  path.win32.basename(path.posix.basename(value));

const executableName = (process: ExternalGameProcess) =>
  basename(process.exe ?? process.name).toLowerCase();

const normalizedSearchText = (value: string) =>
  value.toLowerCase().replace(/[^a-z\d]/g, "");

const titleTokens = (title: string) =>
  title
    .toLowerCase()
    .match(/[a-z\d]+/g)
    ?.filter((token) => token.length >= 3 && !TITLE_STOP_WORDS.has(token)) ??
  [];

const hasTitleCorrelation = (title: string, process: ExternalGameProcess) => {
  const target = normalizedSearchText(
    `${process.name} ${process.exe ? basename(process.exe) : ""}`
  );
  const tokens = titleTokens(title);
  if (!tokens.length || !target) return false;

  const matches = tokens.filter((token) => target.includes(token)).length;
  return matches >= Math.min(2, tokens.length);
};

export const isPotentialExternalGameProcess = (
  process: ExternalGameProcess
) => {
  if (!Number.isInteger(process.pid) || process.pid <= 0) return false;

  const name = executableName(process).replace(/\.exe$/i, "");
  return (
    name.length > 0 &&
    !KNOWN_STORE_OR_SYSTEM_PROCESS.test(name) &&
    !AUXILIARY_PROCESS.test(name)
  );
};

/**
 * A discovered process is detection metadata when the launch command is a URI
 * (or already has a separate native target). Never replace the protocol the
 * store still needs for the next launch.
 */
export const withDiscoveredExecutablePath = <T extends ExecutableTrackedGame>(
  game: T,
  discoveredPath: string
): GameWithDiscoveredExecutable<T> => {
  const hasProtocolLaunchPath = /^[a-z][a-z\d+.-]*:\/\//i.test(
    game.executablePath ?? ""
  );
  return (
    hasProtocolLaunchPath || game.nativeExecutablePath
      ? { ...game, nativeExecutablePath: discoveredPath }
      : { ...game, executablePath: discoveredPath }
  ) as GameWithDiscoveredExecutable<T>;
};

export const beginExternalGameLaunch = (input: {
  gameKey: string;
  objectId: string;
  shop: GameShop;
  title: string;
  protocolUrl: string;
  cloudSaveSessionToken?: string | null;
  baselineProcesses: ExternalGameProcess[];
  baselineForegroundPid?: number;
  now?: number;
}) => {
  const now = input.now ?? Date.now();
  const state: ExternalGameLaunchState = {
    gameKey: input.gameKey,
    objectId: input.objectId,
    shop: input.shop,
    title: input.title,
    protocolUrl: input.protocolUrl,
    cloudSaveSessionToken: input.cloudSaveSessionToken ?? null,
    baselinePids: new Set(input.baselineProcesses.map(({ pid }) => pid)),
    baselineForegroundPid: input.baselineForegroundPid ?? 0,
    // An empty process list means native enumeration failed. Do not treat every
    // process on the machine as newly spawned on the next pass.
    baselineCaptured: input.baselineProcesses.length > 0,
    startedAt: now,
    phase: "pending",
    boundPid: null,
    boundExecutablePath: null,
    lastSeenAt: now,
    observedCandidatePid: null,
    observedCandidateCount: 0,
  };

  launches.set(input.gameKey, state);
  return state;
};

export const getExternalGameLaunch = (gameKey: string) =>
  launches.get(gameKey) ?? null;

export const hasExternalGameLaunch = (gameKey: string) => launches.has(gameKey);

export const hasTrackedExternalGameLaunches = () => launches.size > 0;

export const clearExternalGameLaunch = (gameKey: string) =>
  launches.delete(gameKey);

export const clearAllExternalGameLaunches = () => launches.clear();

export const isExternalGameLaunchExpired = (
  state: ExternalGameLaunchState,
  now = Date.now()
) =>
  state.phase === "pending" &&
  now - state.startedAt >= EXTERNAL_LAUNCH_TIMEOUT_MS;

export const shouldWaitForExternalProcessHandoff = (
  state: ExternalGameLaunchState,
  now = Date.now()
) =>
  state.phase === "bound" &&
  now - state.lastSeenAt < EXTERNAL_PROCESS_HANDOFF_GRACE_MS;

export const markExternalGameLaunchSeen = (
  gameKey: string,
  process?: ExternalGameProcess | null,
  now = Date.now()
) => {
  const state = launches.get(gameKey);
  if (!state) return null;

  state.phase = "bound";
  state.lastSeenAt = now;
  if (process) {
    state.boundPid = process.pid;
    state.boundExecutablePath = process.exe;
  }
  state.observedCandidatePid = null;
  state.observedCandidateCount = 0;
  return state;
};

export const isExternalProcessClaimedByAnotherGame = (
  pid: number,
  gameKey: string
) =>
  [...launches.values()].some(
    (launch) =>
      launch.gameKey !== gameKey &&
      launch.phase === "bound" &&
      launch.boundPid === pid
  );

export const getPotentialExternalLaunchProcesses = (
  state: ExternalGameLaunchState,
  processes: ExternalGameProcess[]
) => {
  if (!state.baselineCaptured) return [];

  return processes.filter(
    (process) =>
      !state.baselinePids.has(process.pid) &&
      process.pid !== state.boundPid &&
      !isExternalProcessClaimedByAnotherGame(process.pid, state.gameKey) &&
      isPotentialExternalGameProcess(process)
  );
};

export const selectExternalLaunchProcess = (input: {
  state: ExternalGameLaunchState;
  processes: ExternalGameProcess[];
  foregroundPid: number;
  windows: ReadonlyMap<number, ExternalProcessWindow>;
  requireVisibleWindow: boolean;
}): ExternalProcessMatch | null => {
  const candidates = getPotentialExternalLaunchProcesses(
    input.state,
    input.processes
  ).filter((process) => {
    if (!input.requireVisibleWindow) return true;
    const bounds = input.windows.get(process.pid);
    return (
      !!bounds &&
      bounds.width >= MIN_GAME_WINDOW_WIDTH &&
      bounds.height >= MIN_GAME_WINDOW_HEIGHT
    );
  });

  if (!candidates.length) return null;

  const foreground = candidates.find(({ pid }) => pid === input.foregroundPid);
  if (foreground) {
    return { process: foreground, confidence: "foreground" };
  }

  const titleMatches = candidates.filter((candidate) =>
    hasTitleCorrelation(input.state.title, candidate)
  );
  if (titleMatches.length === 1) {
    return { process: titleMatches[0], confidence: "title" };
  }

  if (candidates.length === 1) {
    return { process: candidates[0], confidence: "stable-visible" };
  }

  // Multiple new visible processes without a foreground or title signal is
  // ambiguous. Binding one would risk tracking a store UI or unrelated app.
  return null;
};

export const confirmExternalLaunchProcess = (
  gameKey: string,
  match: ExternalProcessMatch,
  now = Date.now()
) => {
  const state = launches.get(gameKey);
  if (!state) return false;

  // Title correlation is deterministic enough to bind immediately. A merely
  // foreground/sole visible process must survive a second watcher pass so an
  // unrelated app opened while the store is preparing cannot steal the game.
  const requiresSecondObservation = match.confidence !== "title";
  if (
    requiresSecondObservation &&
    state.observedCandidatePid !== match.process.pid
  ) {
    state.observedCandidatePid = match.process.pid;
    state.observedCandidateCount = 1;
    return false;
  }

  if (requiresSecondObservation) {
    state.observedCandidateCount += 1;
    if (state.observedCandidateCount < 2) return false;
  }

  markExternalGameLaunchSeen(gameKey, match.process, now);
  return true;
};

export const resetExternalLaunchObservation = (gameKey: string) => {
  const state = launches.get(gameKey);
  if (!state) return;
  state.observedCandidatePid = null;
  state.observedCandidateCount = 0;
};
