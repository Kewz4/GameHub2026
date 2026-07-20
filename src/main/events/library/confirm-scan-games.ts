import path from "node:path";
import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";
import { classifyScannedOrigin } from "@main/helpers/classify-scanned-origin";
import type { EmulatorSystem } from "@types";
import { createHash } from "node:crypto";

interface ApprovedGame {
  key: string;
  executablePath: string;
  /** Present for games discovered on disk that aren't yet in the library. */
  title?: string;
  isNew?: boolean;
  /** Set when the game is a console/emulator ROM. The confirm step creates a
   *  launchbox entry with the matching platform so it appears under the Console
   *  dropdown instead of the Custom/Retigga tab. */
  emulatorSystem?: EmulatorSystem;
}

/** Platform display string for each system — matches SYSTEM_DISPLAY_PLATFORM
 *  in import-sgdb-roms.ts so the Console dropdown's `systemForGame` resolves
 *  the game correctly. */
const SYSTEM_DISPLAY_PLATFORM: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PlayStation Portable",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Nintendo Wii U",
  wii: "Nintendo Wii",
  gc: "Nintendo GameCube",
  switch: "Nintendo Switch",
};

/** Build a synthetic objectId for a ROM, matching the `local-<system>-<hash>`
 *  scheme used by import-sgdb-roms.ts so the game is interchangeable with one
 *  imported through the ROM folder import flow. */
function romObjectId(system: EmulatorSystem, title: string): string {
  const hash = createHash("sha1")
    .update(`${title.trim().toLowerCase()}::`)
    .digest("hex")
    .slice(0, 16);
  return `local-${system}-${hash}`;
}

const confirmScanGames = async (
  _event: Electron.IpcMainInvokeEvent,
  approvedGames: ApprovedGame[]
): Promise<void> => {
  const { addCustomGameToLibraryInternal } = await import(
    "./add-custom-game-to-library"
  );

  // Existing-key confirmations are cheap (local writes only) — patch them first.
  const newGames = approvedGames.filter((g) => g.isNew);
  const existingGames = approvedGames.filter((g) => !g.isNew);

  for (const { key, executablePath } of existingGames) {
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

  // Surface the cheap confirmations immediately so the library updates without
  // waiting on the slow (network-bound) new-game enrichment below.
  if (existingGames.length > 0) {
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  // Newly-discovered games each need catalogue lookups + artwork fetches, which
  // are network-bound. Process them with bounded concurrency (instead of one at
  // a time) and refresh the library as each one lands so they appear
  // progressively rather than all at the very end.
  const CONCURRENCY = 4;
  let cursor = 0;
  const worker = async () => {
    while (cursor < newGames.length) {
      const game = newGames[cursor++];

      if (game.emulatorSystem) {
        // Console/emulator ROM — create a launchbox entry with the matching
        // platform so it appears under the Console dropdown. The gamehub-meta
        // sublevel (loaded at startup from the bundled metadata) will supply
        // art/description for the game based on the system + normalized title.
        const system = game.emulatorSystem;
        const platform = SYSTEM_DISPLAY_PLATFORM[system] ?? system;
        const objectId = romObjectId(system, game.title ?? "Unknown Game");
        const gameKey = levelKeys.game("launchbox", objectId);

        const existing = await gamesSublevel.get(gameKey).catch(() => null);
        if (existing) {
          // Already in library (maybe soft-deleted) — resurrect.
          await gamesSublevel.put(gameKey, {
            ...existing,
            isDeleted: false,
            isInstalledLocally: true,
            executablePath: game.executablePath,
            addedToLibraryAt: existing.addedToLibraryAt ?? new Date(),
          });
        } else {
          await gamesSublevel.put(gameKey, {
            title: game.title ?? "Unknown Game",
            iconUrl: null,
            libraryHeroImageUrl: null,
            logoImageUrl: null,
            objectId,
            shop: "launchbox" as const,
            remoteId: null,
            isDeleted: false,
            playTimeInMilliseconds: 0,
            lastTimePlayed: null,
            addedToLibraryAt: new Date(),
            platform,
            executablePath: game.executablePath,
            discs: [
              {
                path: game.executablePath,
                label: path.basename(game.executablePath),
                fileName: path.basename(game.executablePath),
              },
            ],
            selectedDiscPath: game.executablePath,
            isInstalledLocally: true,
            libraryOrigin: "custom" as const,
          });
        }
        logger.info(
          `[ConfirmScanGames] Added ROM: ${game.title} (${system}) → ${game.executablePath}`
        );
      } else {
        // PC game — use the existing custom-game import path.
        await addCustomGameToLibraryInternal(
          game.title ?? "Unknown Game",
          game.executablePath
        ).catch((err) =>
          logger.error(
            `[ConfirmScanGames] Failed to add new game ${game.title}:`,
            err
          )
        );
      }

      WindowManager.sendToAppWindows("on-library-batch-complete");
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, newGames.length) }, () =>
      worker()
    )
  );

  WindowManager.sendToAppWindows("on-library-batch-complete");

  const hasFoundGames = approvedGames.length > 0;
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
      { ns: "notifications", count: approvedGames.length }
    ),
    { url: "/library?openScanModal=true" }
  );
};

registerEvent("confirmScanGames", confirmScanGames);
