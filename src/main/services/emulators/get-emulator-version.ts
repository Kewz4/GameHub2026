import { spawnSync } from "node:child_process";
import { resolveEmulatorExecutableTarget } from "./macos-app-bundle";
import type { KnownBinary } from "./known-binaries";

const VERSION_RE = /\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]*)/;

export const getEmulatorVersion = (
  executablePath: string,
  binary: KnownBinary
): string | null => {
  const target =
    resolveEmulatorExecutableTarget(executablePath) ?? executablePath;
  for (const flag of binary.versionFlags) {
    try {
      const result = spawnSync(target, [flag], {
        timeout: 5000,
        encoding: "utf-8",
      });
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      const match = VERSION_RE.exec(output);
      if (match) return match[0];
    } catch {
      // try next flag
    }
  }
  return null;
};
