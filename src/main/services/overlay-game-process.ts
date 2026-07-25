import type { Game } from "@types";

import { NativeAddon } from "./native-addon";
import {
  prioritizeVisibleOverlayProcesses,
  rankOverlayGameProcesses,
} from "./overlay-game-process-ranking";

export const getOverlayProcessTargets = (game: Game) => [
  ...new Set(
    [
      game.nativeExecutablePath,
      game.executablePath,
      ...(game.trackingExecutablePaths ?? []),
    ].filter((value): value is string => Boolean(value))
  ),
];

export const findOverlayGameProcesses = async (
  game: Game,
  preferredPid = 0,
  lockPreferredPid = false
) => {
  const targets = getOverlayProcessTargets(game);
  if (!targets.length) return [];

  const [processes, foregroundPid] = await Promise.all([
    NativeAddon.listProcesses(),
    Promise.resolve(NativeAddon.getForegroundProcessId()),
  ]);

  const ranked = rankOverlayGameProcesses(
    processes,
    targets,
    foregroundPid,
    preferredPid,
    lockPreferredPid
  );
  if (process.platform !== "win32") return ranked;
  const visiblePids = new Set(
    ranked
      .filter((candidate) =>
        Boolean(NativeAddon.getProcessWindowBounds(candidate.pid))
      )
      .map((candidate) => candidate.pid)
  );
  return prioritizeVisibleOverlayProcesses(ranked, visiblePids);
};

export const findOverlayGameProcess = async (
  game: Game,
  preferredPid = 0,
  lockPreferredPid = false
) =>
  (await findOverlayGameProcesses(game, preferredPid, lockPreferredPid))[0] ??
  null;
