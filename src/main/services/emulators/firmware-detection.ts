import fs from "node:fs";
import path from "node:path";

/**
 * Detect whether PS3 firmware is installed for an RPCS3 executable.
 *
 * RPCS3's `--installfw` extracts PS3UPDAT.PUP into `dev_flash` next to the
 * executable (RPCS3 is portable by convention). Installed firmware populates
 * `dev_flash/sys/external/` and `dev_flash/vsh/module/` — checking that a
 * couple of those are non-empty avoids false positives from a pre-created but
 * empty `dev_flash` shell.
 */
export const isPs3FirmwareInstalled = async (
  executablePath: string
): Promise<boolean> => {
  try {
    if (!executablePath) return false;
    const devFlash = path.join(path.dirname(executablePath), "dev_flash");
    if (!fs.existsSync(devFlash)) return false;

    const markers = [
      path.join(devFlash, "sys", "external"),
      path.join(devFlash, "vsh", "module"),
    ];
    return markers.some(
      (dir) => fs.existsSync(dir) && fs.readdirSync(dir).length > 0
    );
  } catch {
    return false;
  }
};
