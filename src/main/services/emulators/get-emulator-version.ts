import { spawnSync } from "node:child_process";
import { resolveEmulatorExecutableTarget } from "./macos-app-bundle";
import type { KnownBinary } from "./known-binaries";

const VERSION_RE = /\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]*)/;

/**
 * Binaries whose `versionFlags` are NOT headless — running them with the flag
 * boots the full GUI instead of printing a version string. Skip the probe for
 * these; the version is already known from the release asset filename.
 */
const NON_HEADLESS_BINARIES: ReadonlySet<string> = new Set(["eden"]);

export const getEmulatorVersion = (
  executablePath: string,
  binary: KnownBinary
): string | null => {
  // Eden (Yuzu/Sudachi derivative) doesn't support --version — it launches its
  // Qt GUI instead. Skip the probe entirely; the install option already carries
  // the version from the release asset filename.
  if (NON_HEADLESS_BINARIES.has(binary.binary)) return null;

  const target =
    resolveEmulatorExecutableTarget(executablePath) ?? executablePath;
  for (const flag of binary.versionFlags) {
    try {
      const result = spawnSync(target, [flag], {
        timeout: 5000,
        encoding: "utf-8",
        windowsHide: true,
        shell: false,
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
