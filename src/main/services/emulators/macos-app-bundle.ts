import { existsSync } from "node:fs";
import path from "node:path";

export const findMacAppBundleRoot = (executablePath: string): string | null => {
  if (process.platform !== "darwin") return null;
  const normalized = path.normalize(executablePath);
  if (normalized.endsWith(".app")) return normalized;
  const parts = normalized.split(path.sep);
  const appIdx = parts.findLastIndex((p) => p.endsWith(".app"));
  if (appIdx === -1) return null;
  return parts.slice(0, appIdx + 1).join(path.sep);
};

export const resolveMacAppBundleExecutable = (
  appBundlePath: string
): string | null => {
  if (process.platform !== "darwin") return null;
  const execDir = path.join(appBundlePath, "Contents", "MacOS");
  return existsSync(execDir) ? execDir : null;
};

export const resolveEmulatorExecutableTarget = (
  executablePath: string
): string | null => {
  const bundleRoot = findMacAppBundleRoot(executablePath);
  if (bundleRoot) return resolveMacAppBundleExecutable(bundleRoot);
  return executablePath;
};
