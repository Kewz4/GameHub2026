import fs from "node:fs";
import path from "node:path";
import WinReg from "winreg";

export interface UbisoftGame {
  /** Ubisoft Connect numeric install id — used in uplay://launch/{id}/0 */
  installId: string;
  title: string;
  installDir: string;
  launchUri: string;
}

const INSTALLS_KEY = "\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs";
const UNINSTALL_KEY =
  "\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

const listSubKeys = (key: string): Promise<WinReg.Registry[]> =>
  new Promise((resolve) => {
    new WinReg({ hive: WinReg.HKLM, key }).keys((err, items) =>
      resolve(err ? [] : (items ?? []))
    );
  });

const getRegistryValue = (key: string, name: string): Promise<string | null> =>
  new Promise((resolve) => {
    new WinReg({ hive: WinReg.HKLM, key }).get(name, (err, item) =>
      resolve(err || !item ? null : item.value)
    );
  });

export const getUbisoftClientPath = async (): Promise<string | null> => {
  if (process.platform !== "win32") return null;

  const installDir = await getRegistryValue(
    "\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher",
    "InstallDir"
  );
  if (installDir) {
    const candidates = ["UbisoftConnect.exe", "upc.exe"].map((exe) =>
      path.join(installDir, exe)
    );
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) return found;
  }

  const fallbacks = [
    "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe",
    "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\upc.exe",
  ];
  return fallbacks.find((p) => fs.existsSync(p)) ?? null;
};

export const isUbisoftClientInstalled = async (): Promise<boolean> =>
  (await getUbisoftClientPath()) !== null;

/** Installed games live as numeric subkeys of Ubisoft\Launcher\Installs; the
 * human-readable name comes from the matching "Uplay Install {id}" uninstall
 * entry, falling back to the install folder name. */
export const detectInstalledUbisoftGames = async (): Promise<UbisoftGame[]> => {
  if (process.platform !== "win32") return [];

  const installKeys = await listSubKeys(INSTALLS_KEY);
  const games: UbisoftGame[] = [];

  for (const installKey of installKeys) {
    const installId = installKey.key.split("\\").pop();
    if (!installId || !/^\d+$/.test(installId)) continue;

    const installDir = await getRegistryValue(installKey.key, "InstallDir");
    if (!installDir || !fs.existsSync(installDir)) continue;

    const displayName = await getRegistryValue(
      `${UNINSTALL_KEY}\\Uplay Install ${installId}`,
      "DisplayName"
    );

    games.push({
      installId,
      title:
        displayName ??
        path.basename(installDir.replace(/[\\/]+$/, "")) ??
        `Ubisoft Game ${installId}`,
      installDir,
      launchUri: `uplay://launch/${installId}/0`,
    });
  }

  return games;
};
