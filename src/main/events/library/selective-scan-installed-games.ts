import path from "node:path";
import fs from "node:fs";
import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import {
  GameExecutables,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";
import { classifyScannedOrigin } from "@main/helpers/classify-scanned-origin";
import { discoverRomFiles } from "@main/helpers/scan-executables";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import type { EmulatorSystem } from "@types";

interface FoundGame {
  title: string;
  executablePath: string;
  key: string;
  isNew?: boolean;
  emulatorSystem?: EmulatorSystem;
}
interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

async function findExecutableInFolder(
  folderPath: string,
  executableNames: Set<string>
): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
      recursive: true,
    });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (executableNames.has(entry.name.toLowerCase())) {
        const parentPath =
          "parentPath" in entry ? entry.parentPath : folderPath;
        return path.join(parentPath as string, entry.name);
      }
    }
  } catch (err) {
    logger.error(`[SelectiveScan] Error reading ${folderPath}:`, err);
  }
  return null;
}

const selectiveScanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent,
  scanPaths: string[],
  dryRun = false
): Promise<ScanResult> => {
  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(
          ([, game]) =>
            game.isDeleted === false &&
            game.shop !== "custom" &&
            !game.executablePath
        )
        .map(([key, game]) => ({ key, game }))
    );

  const foundGames: FoundGame[] = [];

  let scanned = 0;
  for (const { key, game } of games) {
    scanned++;
    WindowManager.sendToAppWindows("on-scan-progress", {
      scanned,
      total: games.length,
      foundCount: foundGames.length,
      currentTitle: game.title,
    });

    const executableNames = GameExecutables.getExecutablesForGame(
      game.objectId
    );
    if (!executableNames?.length) continue;
    const normalizedNames = new Set(
      executableNames.map((n) => n.toLowerCase())
    );

    for (const scanPath of scanPaths) {
      const foundPath = await findExecutableInFolder(scanPath, normalizedNames);
      if (foundPath) {
        // ── ROM discovery: scan selected folders for emulator/console ROM files ──
        const allGames = await gamesSublevel.iterator().all();
        const knownRomPaths = new Set(
          allGames
            .filter(([, g]) => g.shop === "launchbox")
            .map(([, g]) => g.executablePath?.toLowerCase())
            .filter((p): p is string => Boolean(p))
        );

        const discoveredRoms = await discoverRomFiles(
          scanPaths,
          (current, total, title) =>
            WindowManager.sendToAppWindows("on-scan-progress", {
              scanned: current,
              total,
              foundCount: foundGames.length,
              currentTitle: `ROM: ${title}`,
            })
        );

        for (const rom of discoveredRoms) {
          const romLower = rom.romPath.toLowerCase();
          if (knownRomPaths.has(romLower)) continue;

          const romNorm = normalizeGameTitle(rom.title);
          const existingRom = allGames.find(
            ([, g]) =>
              g.shop === "launchbox" && normalizeGameTitle(g.title) === romNorm
          );

          if (existingRom) {
            const [existingKey, existingGame] = existingRom;
            if (!dryRun) {
              await gamesSublevel.put(existingKey, {
                ...existingGame,
                isDeleted: false,
                executablePath: rom.romPath,
                isInstalledLocally: true,
              });
            }
            foundGames.push({
              title: existingGame.title,
              executablePath: rom.romPath,
              key: existingKey,
            });
            logger.info(
              `[SelectiveScan] Resolved ROM: ${existingGame.title} → ${rom.romPath}`
            );
            continue;
          }

          // New ROM not in the library — surface for confirmation.
          foundGames.push({
            title: rom.title,
            executablePath: rom.romPath,
            key: `rom:${romLower}`,
            isNew: true,
            emulatorSystem: rom.system,
          });
        }

        if (!dryRun) {
          await gamesSublevel.put(key, {
            ...game,
            executablePath: foundPath,
            // Store folder → owned on that platform; anything else keeps its
            // original origin or becomes custom
            libraryOrigin: classifyScannedOrigin(foundPath, game.libraryOrigin),
          });
        }
        foundGames.push({ title: game.title, executablePath: foundPath, key });
        break;
      }
    }
  }

  if (!dryRun) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
    const hasFoundGames = foundGames.length > 0;
    await LocalNotificationManager.createNotification(
      "SCAN_GAMES_COMPLETE",
      t(
        hasFoundGames
          ? "scan_games_complete_title"
          : "scan_games_no_results_title",
        { ns: "notifications" }
      ),
      t(
        hasFoundGames
          ? "scan_games_complete_description"
          : "scan_games_no_results_description",
        { ns: "notifications", count: foundGames.length }
      ),
      { url: "/library?openScanModal=true" }
    );
  }

  return { foundGames, total: games.length };
};

registerEvent("selectiveScanInstalledGames", selectiveScanInstalledGames);
