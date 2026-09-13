import fs from "node:fs";
import path from "node:path";

export const resolveMediaToolPath = (options: {
  platform: NodeJS.Platform;
  resourcesPath: string;
  appPath: string;
  isPackaged: boolean;
  searchPath?: string;
  executable?: (candidate: string) => boolean;
}) => {
  const fileName = options.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const bundled = path.join(
    options.isPackaged ? options.resourcesPath : options.appPath,
    "ffmpeg",
    fileName
  );
  const executable =
    options.executable ??
    ((candidate: string) => {
      try {
        fs.accessSync(
          candidate,
          options.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK
        );
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  if (executable(bundled) || options.platform === "win32") return bundled;
  for (const directory of (options.searchPath ?? process.env.PATH ?? "").split(
    ":"
  )) {
    // Never resolve an empty/relative PATH entry against the game directory.
    if (!path.posix.isAbsolute(directory)) continue;
    const candidate = path.posix.join(directory, fileName);
    if (executable(candidate)) return candidate;
  }
  return bundled;
};
