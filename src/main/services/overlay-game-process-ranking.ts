import path from "node:path";

export type OverlayProcess = {
  exe: string | null;
  pid: number;
  name: string;
  startTime?: number;
};

export type OverlayProcessCandidate = OverlayProcess & { score: number };

const normalizePath = (value: string) => path.normalize(value).toLowerCase();
const PROTOCOL_PATH = /^[a-z][a-z\d+.-]*:\/\//i;
const UNREAL_SHIPPING_EXECUTABLE = /(?:^|-)(?:win64|wingdk)-shipping\.exe$/i;
const LAUNCH_HELPER_EXECUTABLE =
  /(?:steamclient[_-]?loader|(?:^|[-_.])(?:launcher|bootstrap)(?:[-_.]|$))/i;
const AUXILIARY_EXECUTABLE =
  /(?:crash|report|uninstall|updat(?:e|er)|launcher|bootstrap|steamclient[_-]?loader|easyanticheat|eac|battleye|beservice)/i;
const FOREGROUND_PROCESS_BONUS = 5_000;
// A foreground Unreal render child must beat an exact, still-running launch
// helper (Khazan uses steamclient_loader_x64.exe as its configured entrypoint),
// without letting a generic same-directory utility overpower an exact game.
const UNREAL_FOREGROUND_RENDER_BONUS = 3_000;

export const isOverlayLaunchHelperProcess = (
  process: Pick<OverlayProcess, "exe" | "name">
) =>
  LAUNCH_HELPER_EXECUTABLE.test(
    path.basename(process.exe ? normalizePath(process.exe) : process.name)
  );

/**
 * Launch helpers remain valid session roots, but they are never render targets.
 * Keeping this filter in the overlay consumer (rather than globally removing
 * the processes) lets play-time/session tracking continue to follow them.
 */
export const excludeOverlayLaunchHelpers = <
  T extends Pick<OverlayProcess, "exe" | "name">,
>(
  candidates: T[]
) => candidates.filter((candidate) => !isOverlayLaunchHelperProcess(candidate));

/**
 * Select an actual render window, not merely the best executable-name match.
 * When a game is minimized there may be no eligible visible window, so retain
 * the already validated PID while it still exists. Never fall back to another
 * hidden launcher after that PID exits.
 */
export const selectOverlayRenderProcess = <
  T extends Pick<OverlayProcess, "pid">,
>(
  candidates: T[],
  visiblePids: ReadonlySet<number>,
  currentPid: number
) =>
  candidates.find((candidate) => visiblePids.has(candidate.pid)) ??
  candidates.find(
    (candidate) => currentPid > 0 && candidate.pid === currentPid
  ) ??
  null;

const isWithinDirectory = (candidate: string, directory: string) => {
  const relative = path.relative(directory, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export const rankOverlayGameProcesses = (
  processes: OverlayProcess[],
  targets: string[],
  foregroundPid = 0,
  preferredPid = 0,
  lockPreferredPid = false
): OverlayProcessCandidate[] => {
  const normalizedTargets = targets
    .filter((target) => !PROTOCOL_PATH.test(target))
    .map(normalizePath);
  const installRoots = [
    ...new Set(
      normalizedTargets
        .map((target) => path.dirname(target))
        .filter((directory) => directory && directory !== ".")
    ),
  ];

  return processes
    .map((candidate): OverlayProcessCandidate | null => {
      const executable = candidate.exe ? normalizePath(candidate.exe) : null;
      const processName = candidate.name.toLowerCase();
      let score = 0;

      for (const [index, target] of normalizedTargets.entries()) {
        const targetName = path.basename(target);
        if (executable === target) {
          score = Math.max(score, 10_000 - index * 10);
        } else if (executable && path.basename(executable) === targetName) {
          score = Math.max(score, 2_000 - index * 10);
        } else if (processName === targetName) {
          score = Math.max(score, 1_500 - index * 10);
        }
      }

      if (score === 0 && executable) {
        const executableName = path.basename(executable);
        const isSameInstall =
          !AUXILIARY_EXECUTABLE.test(executableName) &&
          installRoots.some((directory) =>
            isWithinDirectory(executable, directory)
          );
        if (isSameInstall && UNREAL_SHIPPING_EXECUTABLE.test(executableName)) {
          score = 6_500;
        } else if (isSameInstall && candidate.pid === foregroundPid) {
          score = 4_000;
        }
      }

      if (score === 0) return null;
      // While the overlay owns foreground, Windows reports Electron rather
      // than the game as foreground. Keep the already-validated render process
      // selected until its visible window disappears; otherwise a still-open
      // launcher with an exact configured path can steal the overlay.
      if (candidate.pid === preferredPid)
        score += lockPreferredPid ? 100_000 : 2_000;
      // Foreground is a useful signal for launcher -> render-child handoff,
      // but it must not overpower an exact configured executable. A huge
      // foreground bonus previously let unrelated utilities in the install
      // directory steal the target and restart PresentMon every two seconds.
      if (candidate.pid === foregroundPid) {
        score += FOREGROUND_PROCESS_BONUS;
        if (
          executable &&
          UNREAL_SHIPPING_EXECUTABLE.test(path.basename(executable))
        ) {
          score += UNREAL_FOREGROUND_RENDER_BONUS;
        }
      }

      return { ...candidate, score };
    })
    .filter((candidate): candidate is OverlayProcessCandidate => !!candidate)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.startTime ?? 0) - (left.startTime ?? 0) ||
        right.pid - left.pid
    );
};

export const prioritizeVisibleOverlayProcesses = (
  candidates: OverlayProcessCandidate[],
  visiblePids: ReadonlySet<number>
) =>
  candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        Number(visiblePids.has(right.candidate.pid)) -
          Number(visiblePids.has(left.candidate.pid)) ||
        left.index - right.index
    )
    .map(({ candidate }) => candidate);
