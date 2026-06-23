import path from "node:path";
import fs from "node:fs";
import type { Game, AchievementFile } from "@types";
import { Cracker } from "@shared";
import { achievementsLogger } from "../logger";
import { SystemPath } from "../system-path";
import { getSteamLocation, getSteamUsersIds } from "../steam";
import { Wine } from "../wine";

const getAppDataPath = () => {
  if (process.platform === "win32") {
    return SystemPath.getPath("appData");
  }

  const user = SystemPath.getPath("home").split("/").pop();

  return path.join("drive_c", "users", user || "", "AppData", "Roaming");
};

const getDocumentsPath = () => {
  if (process.platform === "win32") {
    return SystemPath.getPath("documents");
  }

  const user = SystemPath.getPath("home").split("/").pop();

  return path.join("drive_c", "users", user || "", "Documents");
};

const getPublicDocumentsPath = () => {
  if (process.platform === "win32") {
    return path.join("C:", "Users", "Public", "Documents");
  }

  return path.join("drive_c", "users", "Public", "Documents");
};

const getLocalAppDataPath = () => {
  if (process.platform === "win32") {
    return path.join(appData, "..", "Local");
  }

  const user = SystemPath.getPath("home").split("/").pop();

  return path.join("drive_c", "users", user || "", "AppData", "Local");
};

const getProgramDataPath = () => {
  if (process.platform === "win32") {
    return path.join("C:", "ProgramData");
  }

  return path.join("drive_c", "ProgramData");
};

//TODO: change to a automatized method
const publicDocuments = getPublicDocumentsPath();
const programData = getProgramDataPath();
const appData = getAppDataPath();
const documents = getDocumentsPath();
const localAppData = getLocalAppDataPath();

const crackers = [
  Cracker.codex,
  Cracker.goldberg,
  Cracker.rune,
  Cracker.onlineFix,
  Cracker.userstats,
  Cracker.rld,
  Cracker.creamAPI,
  Cracker.skidrow,
  Cracker.smartSteamEmu,
  Cracker.empress,
  Cracker.flt,
  Cracker.razor1911,
  // RLE had a path mapping defined below but was never actually scanned
  // because it was missing from this list — its achievements were silently
  // dropped. TENOKE and HOODLUM are modern (2023+) Steam crackers that share
  // the CODEX-lineage achievements.ini format and are very common in recent
  // repacks, so watching them meaningfully improves detection coverage.
  Cracker.rle,
  Cracker.tenoke,
  Cracker.hoodlum,
];

const getPathFromCracker = (cracker: Cracker) => {
  if (cracker === Cracker.codex) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "CODEX"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(appData, "Steam", "CODEX"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.rune) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "RUNE"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.onlineFix) {
    return [
      {
        folderPath: path.join(publicDocuments, "OnlineFix"),
        fileLocation: ["<objectId>", "Stats", "Achievements.ini"],
      },
      {
        folderPath: path.join(publicDocuments, "OnlineFix"),
        fileLocation: ["<objectId>", "Achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.goldberg) {
    return [
      {
        folderPath: path.join(appData, "Goldberg SteamEmu Saves"),
        fileLocation: ["<objectId>", "achievements.json"],
      },
      {
        folderPath: path.join(appData, "GSE Saves"),
        fileLocation: ["<objectId>", "achievements.json"],
      },
    ];
  }

  if (cracker === Cracker.userstats) {
    return [];
  }

  if (cracker === Cracker.rld) {
    return [
      {
        folderPath: path.join(programData, "RLD!"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "Player"),
        fileLocation: ["<objectId>", "stats", "achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "RLD!"),
        fileLocation: ["<objectId>", "stats", "achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "dodi"),
        fileLocation: ["<objectId>", "stats", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.empress) {
    return [
      {
        folderPath: path.join(appData, "EMPRESS", "remote"),
        fileLocation: ["<objectId>", "achievements.json"],
      },
      {
        folderPath: path.join(publicDocuments, "EMPRESS"),
        fileLocation: [
          "<objectId>",
          "remote",
          "<objectId>",
          "achievements.json",
        ],
      },
    ];
  }

  if (cracker === Cracker.skidrow) {
    return [
      {
        folderPath: path.join(documents, "SKIDROW"),
        fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
      },
      {
        folderPath: path.join(documents, "Player"),
        fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
      },
      {
        folderPath: path.join(localAppData, "SKIDROW"),
        fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
      },
    ];
  }

  if (cracker === Cracker.creamAPI) {
    return [
      {
        folderPath: path.join(appData, "CreamAPI"),
        fileLocation: ["<objectId>", "stats", "CreamAPI.Achievements.cfg"],
      },
    ];
  }

  if (cracker === Cracker.smartSteamEmu) {
    return [
      {
        folderPath: path.join(appData, "SmartSteamEmu"),
        fileLocation: ["<objectId>", "User", "Achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker._3dm) {
    return [];
  }

  if (cracker === Cracker.flt) {
    return [
      // {
      //   folderPath: path.join(appData, "FLT"),
      //   fileLocation: ["stats"],
      // },
    ];
  }

  if (cracker == Cracker.rle) {
    return [
      {
        folderPath: path.join(appData, "RLE"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(appData, "RLE"),
        fileLocation: ["<objectId>", "Achievements.ini"],
      },
    ];
  }

  if (cracker == Cracker.razor1911) {
    return [
      {
        folderPath: path.join(appData, ".1911"),
        fileLocation: ["<objectId>", "achievement"],
      },
    ];
  }

  // TENOKE — modern Steam cracker (CODEX-lineage achievements.ini format).
  if (cracker == Cracker.tenoke) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "TENOKE"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(appData, "Steam", "TENOKE"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
    ];
  }

  // HOODLUM — modern Steam cracker (CODEX-lineage achievements.ini format).
  if (cracker == Cracker.hoodlum) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "HOODLUM"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(appData, "Steam", "HOODLUM"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
    ];
  }

  achievementsLogger.error(`Cracker ${cracker} not implemented`);
  throw new Error(`Cracker ${cracker} not implemented`);
};

export const getAlternativeObjectIds = (objectId: string) => {
  // Dishonored
  if (objectId === "205100") {
    return ["205100", "217980", "31292"];
  }

  return [objectId];
};

export const findAchievementFiles = (game: Game) => {
  const achievementFiles: AchievementFile[] = [];
  const effectiveWinePrefixPath =
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId) ?? "";

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of getPathFromCracker(cracker)) {
      for (const objectId of getAlternativeObjectIds(game.objectId)) {
        const filePath = path.join(
          effectiveWinePrefixPath,
          folderPath,
          ...mapFileLocationWithObjectId(fileLocation, objectId)
        );

        if (fs.existsSync(filePath)) {
          achievementFiles.push({
            type: cracker,
            filePath,
          });
        }
      }
    }
  }

  const achievementFileInsideDirectory =
    findAchievementFileInExecutableDirectory(game);

  return achievementFiles.concat(achievementFileInsideDirectory);
};

const steamUserIds = await getSteamUsersIds();
const steamPath = await getSteamLocation().catch(() => null);

export const findAchievementFileInSteamPath = (game: Game) => {
  if (!steamUserIds.length) {
    return [];
  }

  if (!steamPath) {
    return [];
  }

  const achievementFiles: AchievementFile[] = [];

  for (const steamUserId of steamUserIds) {
    const gameAchievementPath = path.join(
      steamPath,
      "userdata",
      steamUserId.toString(),
      "config",
      "librarycache",
      `${game.objectId}.json`
    );

    if (fs.existsSync(gameAchievementPath)) {
      achievementFiles.push({
        type: Cracker.Steam,
        filePath: gameAchievementPath,
      });
    }
  }

  return achievementFiles;
};

export const findAchievementFileInExecutableDirectory = (
  game: Game
): AchievementFile[] => {
  if (!game.executablePath) {
    return [];
  }

  const effectiveWinePrefixPath =
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId) ?? "";

  return [
    {
      type: Cracker.userstats,
      filePath: path.join(
        effectiveWinePrefixPath,
        game.executablePath,
        "..",
        "SteamData",
        "user_stats.ini"
      ),
    },
    {
      type: Cracker._3dm,
      filePath: path.join(
        effectiveWinePrefixPath,
        game.executablePath,
        "..",
        "3DMGAME",
        "Player",
        "stats",
        "achievements.ini"
      ),
    },
    // SmartSteamEmu local install
    {
      type: Cracker.smartSteamEmu,
      filePath: path.join(
        effectiveWinePrefixPath,
        game.executablePath,
        "..",
        "SmartSteamEmu",
        "User",
        "Achievements.ini"
      ),
    },
    // CreamAPI local stats directory
    {
      type: Cracker.creamAPI,
      filePath: path.join(
        effectiveWinePrefixPath,
        game.executablePath,
        "..",
        "stats",
        "CreamAPI.Achievements.cfg"
      ),
    },
    // Goldberg local - steam_settings variant
    {
      type: Cracker.goldberg,
      filePath: path.join(
        effectiveWinePrefixPath,
        game.executablePath,
        "..",
        "steam_settings",
        "achievements.json"
      ),
    },
    // Goldberg local - stats directory variant
    {
      type: Cracker.goldberg,
      filePath: path.join(
        effectiveWinePrefixPath,
        game.executablePath,
        "..",
        "stats",
        "achievements.json"
      ),
    },
  ].filter((file) => fs.existsSync(file.filePath)) as AchievementFile[];
};

const HEURISTIC_PATTERNS: Array<{ name: string; type: Cracker }> = [
  { name: "achievements.json", type: Cracker.goldberg },
  { name: "achievements.ini", type: Cracker.codex },
  { name: "achiev.ini", type: Cracker.skidrow },
  { name: "user_stats.ini", type: Cracker.userstats },
  { name: "CreamAPI.Achievements.cfg", type: Cracker.creamAPI },
  { name: "Achievements.ini", type: Cracker.smartSteamEmu },
];

const looksLikeAchievementData = (filePath: string, type: Cracker): boolean => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (type === Cracker.goldberg) {
      return content.includes('"earned"') || content.includes('"achieved"');
    }
    const lower = content.toLowerCase();
    return (
      lower.includes("achieved") ||
      lower.includes("unlocked") ||
      lower.includes("earned")
    );
  } catch {
    return false;
  }
};

export const heuristicScanAchievementFiles = (
  game: Game,
  maxDepth = 3
): AchievementFile[] => {
  if (!game.executablePath) return [];

  const effectiveWinePrefixPath =
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId) ?? "";

  const installDir = path.resolve(
    path.join(effectiveWinePrefixPath, path.dirname(game.executablePath))
  );

  const results: AchievementFile[] = [];
  const seen = new Set<string>();

  const scan = (dir: string, depth: number) => {
    if (depth === 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath, depth - 1);
      } else if (entry.isFile()) {
        const match = HEURISTIC_PATTERNS.find(
          (p) => entry.name.toLowerCase() === p.name.toLowerCase()
        );
        if (match && !seen.has(fullPath)) {
          seen.add(fullPath);
          if (looksLikeAchievementData(fullPath, match.type)) {
            results.push({ type: match.type, filePath: fullPath });
          }
        }
      }
    }
  };

  scan(installDir, maxDepth);
  return results;
};

const EMULATOR_SIGNATURES = [
  "steam_emu.ini",
  "SmartSteamEmu.ini",
  "SmartSteamEmu64.ini",
  "cream_api.ini",
  "CreamAPI.ini",
  "goldberg_steam_emu.ini",
  "steam_settings",
  "SteamData",
  "3DMGAME",
  "SmartSteamEmu",
];

export const hasAchievementEmulatorSignature = (game: Game): boolean => {
  if (!game.executablePath) return false;

  const effectiveWinePrefixPath =
    Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId) ?? "";

  const installDir = path.resolve(
    path.join(effectiveWinePrefixPath, path.dirname(game.executablePath))
  );

  return EMULATOR_SIGNATURES.some((sig) =>
    fs.existsSync(path.join(installDir, sig))
  );
};

const mapFileLocationWithObjectId = (
  fileLocation: string[],
  objectId: string
) => {
  return fileLocation.map((location) =>
    location.replace("<objectId>", objectId)
  );
};

export const findAllAchievementFiles = () => {
  const gameAchievementFiles = new Map<string, AchievementFile[]>();

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of getPathFromCracker(cracker)) {
      if (!fs.existsSync(folderPath)) {
        continue;
      }

      const objectIds = fs.readdirSync(folderPath);

      for (const objectId of objectIds) {
        const filePath = path.join(
          folderPath,
          ...mapFileLocationWithObjectId(fileLocation, objectId)
        );

        if (!fs.existsSync(filePath)) continue;

        const achivementFile = {
          type: cracker,
          filePath,
        };

        gameAchievementFiles.get(objectId)
          ? gameAchievementFiles.get(objectId)!.push(achivementFile)
          : gameAchievementFiles.set(objectId, [achivementFile]);
      }
    }
  }

  return gameAchievementFiles;
};
