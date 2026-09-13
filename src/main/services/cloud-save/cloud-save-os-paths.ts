import path from "node:path";

import type { CloudSavePathContext } from "@types";

interface ResolveCloudSaveAppDataDirInput {
  platform: CloudSavePathContext["platform"];
  homeDir: string;
  electronAppDataDir?: string;
  windowsAppDataDir?: string;
}

const nonEmptyAbsoluteWindowsPath = (value?: string) => {
  const candidate = value?.trim();
  return candidate && path.win32.isAbsolute(candidate) ? candidate : undefined;
};

/**
 * Electron's `appData` path is intentionally redirected into GameHub's data
 * folder in portable mode. Save manifests, however, use `<winAppData>` to mean
 * the Windows user's real Roaming AppData known folder. Keep those two roots
 * separate so portable storage cannot redirect game-save discovery.
 */
export const resolveCloudSaveAppDataDir = ({
  platform,
  homeDir,
  electronAppDataDir,
  windowsAppDataDir,
}: ResolveCloudSaveAppDataDirInput) => {
  if (platform !== "windows") {
    return electronAppDataDir?.trim() || undefined;
  }

  return (
    nonEmptyAbsoluteWindowsPath(windowsAppDataDir) ??
    path.win32.join(homeDir, "AppData", "Roaming")
  );
};
