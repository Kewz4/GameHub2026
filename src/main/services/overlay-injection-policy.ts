import path from "node:path";

import type { Game } from "@types";
import type { ProcessPayload } from "./download/types";

const URI_EXECUTABLE = /^[a-z][a-z\d+.-]*:\/\//i;
const ANTI_CHEAT_PROCESS =
  /(?:easyanticheat|eaanticheat|battleye|beservice|bedaisy|(?:^|[\\/_. -])(?:vgk|vgc)(?:[\\/_. -]|$)|faceit|equ8|ricochet|randgrid|pnkbstr|xigncode|nprotect|gameguard|mhyprot|wellbia|hoyokprotect|anticheatexpert)/i;

export type OverlayInjectionEligibility =
  | { allowed: true }
  | { allowed: false; reason: string };

const isPathWithin = (candidate: string, parent: string) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

/**
 * DLL injection is limited to manually managed, local/offline titles. Synced
 * platform libraries and protocol launches may be online/protected and are
 * never modified merely because their game window was detected.
 */
export const evaluateOverlayInjectionEligibility = (
  game: Pick<
    Game,
    | "libraryOrigin"
    | "executablePath"
    | "nativeExecutablePath"
    | "trackingExecutablePaths"
  > | null,
  targetExecutable: string | null
): OverlayInjectionEligibility => {
  if (
    !game ||
    (game.libraryOrigin !== "catalog" && game.libraryOrigin !== "custom")
  ) {
    return { allowed: false, reason: "platform-managed-title" };
  }
  const configured = [
    game.nativeExecutablePath,
    game.executablePath,
    ...(game.trackingExecutablePaths ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
  if (
    !targetExecutable ||
    !path.isAbsolute(targetExecutable) ||
    URI_EXECUTABLE.test(targetExecutable) ||
    configured.some((value) => URI_EXECUTABLE.test(value))
  ) {
    return { allowed: false, reason: "non-local-executable" };
  }
  const normalizedTarget = path.normalize(targetExecutable);
  const ownsTarget = configured.some((value) => {
    if (!path.isAbsolute(value) || URI_EXECUTABLE.test(value)) return false;
    const normalizedConfigured = path.normalize(value);
    if (normalizedConfigured.toLowerCase() === normalizedTarget.toLowerCase()) {
      return true;
    }
    const configuredRoot = path.dirname(normalizedConfigured);
    // Never turn a drive/root-level launcher record into authority over every
    // executable on that volume. Render children must remain under a concrete
    // configured game directory.
    if (configuredRoot === path.parse(configuredRoot).root) return false;
    return isPathWithin(normalizedTarget, configuredRoot);
  });
  if (!ownsTarget) {
    return { allowed: false, reason: "unrelated-target-executable" };
  }
  return { allowed: true };
};

/** Reject a sibling anti-cheat/service process in the selected install tree. */
export const findOverlayAntiCheatProcess = (
  processes: ProcessPayload[],
  targetExecutable: string,
  configuredExecutables: Array<string | null | undefined> = []
) => {
  const normalizedTarget = path.normalize(targetExecutable);
  const configuredRoots = configuredExecutables
    .filter(
      (value): value is string =>
        Boolean(value?.trim()) &&
        path.isAbsolute(value as string) &&
        !URI_EXECUTABLE.test(value as string)
    )
    .map((value) => path.dirname(path.normalize(value)))
    .filter((root) => isPathWithin(normalizedTarget, root))
    .sort((left, right) => left.length - right.length);
  // A launcher commonly sits at the install root while the real renderer is
  // nested under e.g. Binaries/Win64. Anchor the scan at the broadest verified
  // configured root that still owns the exact target. Falling back to the
  // target directory preserves the previous fail-closed behavior when a
  // legacy record has no usable local launch path.
  const installRoot =
    configuredRoots[0] ?? path.dirname(path.normalize(targetExecutable));
  return (
    processes.find((process) => {
      const executable = process.exe ? path.normalize(process.exe) : "";
      if (!ANTI_CHEAT_PROCESS.test(`${process.name} ${executable}`)) {
        return false;
      }
      const relative = executable ? path.relative(installRoot, executable) : "";
      return (
        !executable ||
        relative === "" ||
        (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    }) ?? null
  );
};

/** Revalidate that the selected PID still names the exact render executable. */
export const isExactOverlayTargetProcess = (
  processes: ProcessPayload[],
  targetPid: number,
  targetExecutable: string
) => {
  if (!Number.isInteger(targetPid) || targetPid <= 4) return false;
  const process = processes.find((candidate) => candidate.pid === targetPid);
  if (!process?.exe) return false;
  return (
    path.normalize(process.exe).toLowerCase() ===
    path.normalize(targetExecutable).toLowerCase()
  );
};
