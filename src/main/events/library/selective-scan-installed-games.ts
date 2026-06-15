import path from "node:path";
import fs from "node:fs";
import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { GameExecutables, LocalNotificationManager, logger, WindowManager } from "@main/services";
import { classifyScannedOrigin } from "@main/helpers/classify-scanned-origin";

interface FoundGame { title: string; executablePath: string; key: string; }
interface ScanResult { foundGames: FoundGame[]; total: number; }

async function findExecutableInFolder(folderPath: string, executableNames: Set<string>): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (executableNames.has(entry.name.toLowerCase())) {
        const parentPath = "parentPath" in entry ? entry.parentPath : folderPath;
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
  const games = await gamesSublevel.iterator().all().then((results) =>
    results.filter(([, game]) => game.isDeleted === false && game.shop !== "custom" && !game.executablePath).map(([key, game]) => ({ key, game }))
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

    const executableNames = GameExecutables.getExecutablesForGame(game.objectId);
    if (!executableNames?.length) continue;
    const normalizedNames = new Set(executableNames.map((n) => n.toLowerCase()));

    for (const scanPath of scanPaths) {
      const foundPath = await findExecutableInFolder(scanPath, normalizedNames);
      if (foundPath) {
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
      t(hasFoundGames ? "scan_games_complete_title" : "scan_games_no_results_title", { ns: "notifications" }),
      t(hasFoundGames ? "scan_games_complete_description" : "scan_games_no_results_description", { ns: "notifications", count: foundGames.length }),
      { url: "/library?openScanModal=true" }
    );
  }

  return { foundGames, total: games.length };
};

registerEvent("selectiveScanInstalledGames", selectiveScanInstalledGames);
