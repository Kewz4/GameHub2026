import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { LocalNotificationManager, logger, WindowManager } from "@main/services";
import { classifyScannedOrigin } from "@main/helpers/classify-scanned-origin";

interface ApprovedGame {
  key: string;
  executablePath: string;
}

const confirmScanGames = async (
  _event: Electron.IpcMainInvokeEvent,
  approvedGames: ApprovedGame[]
): Promise<void> => {
  for (const { key, executablePath } of approvedGames) {
    const game = await gamesSublevel.get(key).catch(() => null);
    if (!game) continue;
    await gamesSublevel.put(key, {
      ...game,
      executablePath,
      // Store folder → owned on that platform; anything else keeps its
      // original origin (catalogue repacks stay in Retigga) or becomes custom
      libraryOrigin: classifyScannedOrigin(executablePath, game.libraryOrigin),
    });
    logger.info(`[ConfirmScanGames] Confirmed ${key}: ${executablePath}`);
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");

  const hasFoundGames = approvedGames.length > 0;
  await LocalNotificationManager.createNotification(
    "SCAN_GAMES_COMPLETE",
    t(hasFoundGames ? "scan_games_complete_title" : "scan_games_no_results_title", { ns: "notifications" }),
    t(hasFoundGames ? "scan_games_complete_description" : "scan_games_no_results_description", { ns: "notifications", count: approvedGames.length }),
    { url: "/library?openScanModal=true" }
  );
};

registerEvent("confirmScanGames", confirmScanGames);
