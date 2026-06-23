import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import { LocalNotificationManager, logger, WindowManager } from "@main/services";
import { classifyScannedOrigin } from "@main/helpers/classify-scanned-origin";

interface ApprovedGame {
  key: string;
  executablePath: string;
  /** Present for games discovered on disk that aren't yet in the library. */
  title?: string;
  isNew?: boolean;
}

const confirmScanGames = async (
  _event: Electron.IpcMainInvokeEvent,
  approvedGames: ApprovedGame[]
): Promise<void> => {
  const { addCustomGameToLibraryInternal } = await import(
    "./add-custom-game-to-library"
  );

  for (const { key, executablePath, title, isNew } of approvedGames) {
    // Newly-discovered game: create a fresh entry (catalogue-matched when
    // possible, otherwise a custom game) instead of patching an existing key.
    if (isNew) {
      await addCustomGameToLibraryInternal(
        title ?? "Unknown Game",
        executablePath
      ).catch((err) =>
        logger.error(`[ConfirmScanGames] Failed to add new game ${title}:`, err)
      );
      continue;
    }

    const game = await gamesSublevel.get(key).catch(() => null);
    if (!game) continue;
    await gamesSublevel.put(key, {
      ...game,
      // Resurrect previously-deleted records — the user just confirmed the game
      // was found on disk and wants it back in the library.
      isDeleted: false,
      isInstalledLocally: true,
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
