import fs from "node:fs";
import path from "node:path";
import WinReg from "winreg";

export interface EaGame {
  /** EA/Origin offer id (e.g. "OFB-EAST:109552409") — used in
   * origin2://game/launch?offerIds={id}. Null when only registry data
   * was available; those games launch by opening the EA app. */
  offerId: string | null;
  title: string;
  installDir: string | null;
}

const getRegistryValue = (
  hive: string,
  key: string,
  name: string
): Promise<string | null> =>
  new Promise((resolve) => {
    new WinReg({ hive, key }).get(name, (err, item) =>
      resolve(err || !item ? null : item.value)
    );
  });

const listSubKeys = (key: string): Promise<WinReg.Registry[]> =>
  new Promise((resolve) => {
    new WinReg({ hive: WinReg.HKLM, key }).keys((err, items) =>
      resolve(err ? [] : (items ?? []))
    );
  });

export const getEaClientPath = async (): Promise<string | null> => {
  if (process.platform !== "win32") return null;

  // EA Desktop (new client)
  const eaDesktop = await getRegistryValue(
    WinReg.HKLM,
    "\\SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Desktop",
    "DesktopAppPath"
  );
  if (eaDesktop && fs.existsSync(eaDesktop)) return eaDesktop;

  // Origin (legacy client) — EA Desktop migrations keep these keys around
  for (const valueName of ["ClientPath", "OriginPath"]) {
    const originPath = await getRegistryValue(
      WinReg.HKLM,
      "\\SOFTWARE\\WOW6432Node\\Origin",
      valueName
    );
    if (originPath && fs.existsSync(originPath)) return originPath;
  }

  const fallbacks = [
    "C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe",
    "C:\\Program Files (x86)\\Origin\\Origin.exe",
  ];
  return fallbacks.find((p) => fs.existsSync(p)) ?? null;
};

export const isEaClientInstalled = async (): Promise<boolean> =>
  (await getEaClientPath()) !== null;

/** Origin/EA app writes one {GameName}\*.mfst per installed game, containing
 * a URL-encoded query string with the offer id and install path. */
const detectFromLocalContent = (): EaGame[] => {
  const localContent = path.join(
    process.env.ProgramData ?? "C:\\ProgramData",
    "Origin",
    "LocalContent"
  );
  if (!fs.existsSync(localContent)) return [];

  const games: EaGame[] = [];

  for (const dirent of fs.readdirSync(localContent, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const gameDir = path.join(localContent, dirent.name);

    try {
      const mfst = fs
        .readdirSync(gameDir)
        .find((f) => f.toLowerCase().endsWith(".mfst"));
      if (!mfst) continue;

      const raw = fs.readFileSync(path.join(gameDir, mfst), "utf8");
      const query = new URLSearchParams(raw.replace(/^\?/, ""));
      const offerId = query.get("id");
      const installPath = query.get("dipinstallpath");

      // Skip uninstalled leftovers
      if (installPath && !fs.existsSync(installPath)) continue;

      games.push({
        offerId,
        title: dirent.name,
        installDir: installPath,
      });
    } catch {
      // Unreadable manifest — skip this entry
    }
  }

  return games;
};

/** EA installers also register HKLM\SOFTWARE\WOW6432Node\EA Games\{Game}
 * with DisplayName + Install Dir. No offer id there, so these entries
 * launch by opening the EA app. */
const detectFromRegistry = async (): Promise<EaGame[]> => {
  const subKeys = await listSubKeys("\\SOFTWARE\\WOW6432Node\\EA Games");
  const games: EaGame[] = [];

  for (const subKey of subKeys) {
    const installDir = await getRegistryValue(
      WinReg.HKLM,
      subKey.key,
      "Install Dir"
    );
    if (!installDir || !fs.existsSync(installDir)) continue;

    const displayName = await getRegistryValue(
      WinReg.HKLM,
      subKey.key,
      "DisplayName"
    );

    games.push({
      offerId: null,
      title: displayName ?? (subKey.key.split("\\").pop() || "EA Game"),
      installDir,
    });
  }

  return games;
};

export const detectInstalledEaGames = async (): Promise<EaGame[]> => {
  if (process.platform !== "win32") return [];

  const fromManifests = detectFromLocalContent();
  const fromRegistry = await detectFromRegistry();

  // Manifest entries win (they carry the offer id); dedupe by install dir/title
  const seen = new Set(
    fromManifests.map((g) => (g.installDir ?? g.title).toLowerCase())
  );
  const merged = [...fromManifests];
  for (const game of fromRegistry) {
    const key = (game.installDir ?? game.title).toLowerCase();
    const titleKey = game.title.trim().toLowerCase();
    if (
      seen.has(key) ||
      fromManifests.some((m) => m.title.trim().toLowerCase() === titleKey)
    ) {
      continue;
    }
    seen.add(key);
    merged.push(game);
  }

  return merged;
};

export const getEaLaunchUri = (game: EaGame): string =>
  game.offerId
    ? `origin2://game/launch?offerIds=${encodeURIComponent(game.offerId)}&autoDownload=1`
    : "origin2://library/open";
