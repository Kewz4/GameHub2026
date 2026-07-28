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
const AUXILIARY_EXECUTABLE =
  /(?:crash|report|uninstall|updat(?:e|er)|launcher|bootstrap|easyanticheat|eac|battleye|beservice)/i;
const FOREGROUND_PROCESS_BONUS = 5_000;

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
      if (candidate.pid === foregroundPid) score += FOREGROUND_PROCESS_BONUS;

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
