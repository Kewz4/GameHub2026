import { registerEvent } from "../register-event";
import cp from "node:child_process";
import path from "node:path";

/**
 * Read the FileDescription (or ProductName fallback) from a Windows exe's
 * version resources. Returns null on non-Windows or if the info isn't found.
 */
const getExeName = async (
  _event: Electron.IpcMainInvokeEvent,
  exePath: string
): Promise<string | null> => {
  if (process.platform !== "win32") return null;

  return new Promise((resolve) => {
    const script = `(Get-Item "${exePath.replace(/"/g, '\\"')}").VersionInfo | Select-Object -ExpandProperty FileDescription`;
    cp.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5_000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const desc = stdout.trim();
        if (desc && desc.toLowerCase() !== "n/a" && desc.length > 0) {
          return resolve(desc);
        }
        // Fallback: ProductName
        const fallback = `(Get-Item "${exePath.replace(/"/g, '\\"')}").VersionInfo | Select-Object -ExpandProperty ProductName`;
        cp.execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", fallback],
          { timeout: 5_000 },
          (err2, stdout2) => {
            if (err2) return resolve(null);
            const prod = stdout2.trim();
            resolve(prod && prod.toLowerCase() !== "n/a" ? prod : null);
          }
        );
      }
    );
    void path; // keep import
  });
};

registerEvent("getExeName", getExeName);
