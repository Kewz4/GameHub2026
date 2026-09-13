export interface GameProcessTerminationDependencies {
  platform: NodeJS.Platform;
  taskkillExecutable: string;
  taskkillWorkingDirectory: string;
  kill: (pid: number) => void;
  launchElevated: (
    executable: string,
    parameters: string,
    workingDirectory: string
  ) => boolean;
}

export interface GameProcessTerminationRequest {
  requested: boolean;
  elevated: boolean;
}

/**
 * Try the ordinary process handle first. Elevated games reject that handle;
 * on Windows an explicit Close Game action may then request the OS `runas`
 * path. This replaces sudo-prompt, whose Node 24 compatibility shim crashes
 * before Windows can show the consent prompt.
 */
export const requestGameProcessTermination = (
  pid: number,
  dependencies: GameProcessTerminationDependencies
): GameProcessTerminationRequest => {
  if (!Number.isSafeInteger(pid) || pid <= 4) {
    return { requested: false, elevated: false };
  }

  try {
    dependencies.kill(pid);
    return { requested: true, elevated: false };
  } catch {
    if (dependencies.platform !== "win32") {
      return { requested: false, elevated: false };
    }

    return {
      requested: dependencies.launchElevated(
        dependencies.taskkillExecutable,
        `/PID ${String(pid)} /T /F`,
        dependencies.taskkillWorkingDirectory
      ),
      elevated: true,
    };
  }
};
