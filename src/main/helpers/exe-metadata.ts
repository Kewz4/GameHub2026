import cp from "node:child_process";
import path from "node:path";

/**
 * Windows exe version-info metadata (the "Details" tab in file Properties).
 * The FileDescription / ProductName fields usually carry the real game name
 * ("Death Must Die"), which beats any folder-name heuristic — download-site
 * folders like "Death Must Die -SteamGG.NET" don't touch the exe itself.
 */

export function getExeVersionField(
  exePath: string,
  field: string,
  timeoutMs = 5_000
): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-Item "${exePath.replace(/"/g, '\\"')}").VersionInfo.${field}`;
    cp.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: timeoutMs },
      (err, stdout) => {
        if (err) return resolve(null);
        const val = stdout.trim();
        resolve(
          val && val.toLowerCase() !== "n/a" && val.length > 1 ? val : null
        );
      }
    );
  });
}

// Descriptions that are engine/installer boilerplate, not a game name.
const JUNK_DESCRIPTION_RE =
  /^(application|launcher|game|setup|install(er)?|uninstall(er)?|bootstrappackagedgame|unrealengine|unitycrashhandler.*)$/i;

/**
 * Best game title from an exe's version info, or null when the metadata is
 * missing or boilerplate. Light cleanup only (trademark glyphs, whitespace) —
 * descriptions are human-authored, so the folder-name heuristics (camelCase
 * splitting etc.) must NOT run on them ("NieR" would become "Nie R").
 */
export async function getExeGameTitle(
  exePath: string,
  timeoutMs = 5_000
): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const filename = path.basename(exePath, path.extname(exePath));

  for (const field of ["FileDescription", "ProductName"]) {
    const raw = await getExeVersionField(exePath, field, timeoutMs);
    if (!raw) continue;

    const val = raw
      .replace(/[™®©]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!val || val.length < 2) continue;
    if (/\.exe$/i.test(val)) continue; // literally "GameName.exe"
    if (val.toLowerCase() === filename.toLowerCase()) continue; // no gain
    if (JUNK_DESCRIPTION_RE.test(val)) continue;
    return val;
  }
  return null;
}
