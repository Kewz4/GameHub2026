import fs from "node:fs";
import path from "node:path";

/** Riot has no per-game URL scheme — every game is launched through
 * RiotClientServices.exe with --launch-product/--launch-patchline args. */
export interface RiotGame {
  productId: string;
  patchline: string;
  title: string;
  defaultInstallPaths: string[];
}

export const RIOT_GAMES: RiotGame[] = [
  {
    productId: "league_of_legends",
    patchline: "live",
    title: "League of Legends",
    defaultInstallPaths: ["C:\\Riot Games\\League of Legends"],
  },
  {
    productId: "valorant",
    patchline: "live",
    title: "VALORANT",
    defaultInstallPaths: ["C:\\Riot Games\\VALORANT\\live"],
  },
  {
    productId: "bacon",
    patchline: "live",
    title: "Legends of Runeterra",
    defaultInstallPaths: ["C:\\Riot Games\\LoR\\live"],
  },
];

const getProgramData = (): string =>
  process.env.ProgramData ?? "C:\\ProgramData";

export const getRiotClientPath = (): string | null => {
  if (process.platform !== "win32") return null;

  // RiotClientInstalls.json is the authoritative client location
  const installsJson = path.join(
    getProgramData(),
    "Riot Games",
    "RiotClientInstalls.json"
  );
  try {
    if (fs.existsSync(installsJson)) {
      const parsed = JSON.parse(fs.readFileSync(installsJson, "utf8")) as {
        rc_default?: string;
        rc_live?: string;
      };
      const candidate = parsed.rc_default ?? parsed.rc_live;
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // fall through to default locations
  }

  const fallbacks = [
    "C:\\Riot Games\\Riot Client\\RiotClientServices.exe",
    "C:\\Program Files\\Riot Games\\Riot Client\\RiotClientServices.exe",
  ];
  return fallbacks.find((p) => fs.existsSync(p)) ?? null;
};

export const isRiotClientInstalled = (): boolean =>
  getRiotClientPath() !== null;

/** A game is installed when the Riot client wrote its metadata folder
 * (ProgramData\Riot Games\Metadata\{product}.{patchline}) or the game's
 * default install directory exists. */
export const detectInstalledRiotGames = (): RiotGame[] => {
  if (process.platform !== "win32") return [];

  const metadataDir = path.join(getProgramData(), "Riot Games", "Metadata");

  return RIOT_GAMES.filter((game) => {
    const metadataPath = path.join(
      metadataDir,
      `${game.productId}.${game.patchline}`
    );
    if (fs.existsSync(metadataPath)) return true;
    return game.defaultInstallPaths.some((p) => fs.existsSync(p));
  });
};

export const getRiotLaunchOptions = (game: RiotGame): string =>
  `--launch-product=${game.productId} --launch-patchline=${game.patchline}`;
