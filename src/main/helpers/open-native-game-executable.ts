export class NativeGameLaunchError extends Error {
  public readonly code = "game_launch_failed";

  public constructor(
    public readonly executablePath: string,
    details: string,
    options?: ErrorOptions
  ) {
    super(`Game could not be started: ${details}`, options);
    this.name = "NativeGameLaunchError";
  }
}

type OpenPath = (executablePath: string) => Promise<string>;

/** Await Electron's openPath result; a non-empty string is an OS launch error. */
export const openNativeGameExecutable = async (
  executablePath: string,
  openPath: OpenPath
): Promise<void> => {
  let result: string;
  try {
    result = await openPath(executablePath);
  } catch (error) {
    throw new NativeGameLaunchError(
      executablePath,
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }

  if (result.trim()) {
    throw new NativeGameLaunchError(executablePath, result.trim());
  }
};
