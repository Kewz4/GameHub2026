import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import {
  GameExecutables,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";
import {
  discoverScanDirectories,
  indexExecutables,
} from "@main/helpers/scan-executables";

interface FoundGame {
  title: string;
  executablePath: string;
  key: string;
}

interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

async function publishScanNotification(foundCount: number): Promise<void> {
  const hasFoundGames = foundCount > 0;

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
      { ns: "notifications", count: foundCount }
    ),
    { url: "/library?openScanModal=true" }
  );
}

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent,
  dryRun = false
): Promise<ScanResult> => {
  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(([_key, game]) => game.shop !== "custom")
        .map(([key, game]) => ({ key, game }))
    );

  const foundGames: FoundGame[] = [];
  // Scan a game when it has no resolved executable yet, OR when it has been
  // deleted from the library — deleted games are re-discovered and resurrected
  // when their executable is still on disk (e.g. after clearing the library).
  const gamesToScan = games.filter(
    (g) => g.game.isDeleted || !g.game.executablePath
  );

  // Build the wanted executable-name set across ALL games up front, then walk
  // each scan directory ONCE to resolve them (a single O(tree) pass instead of
  // re-walking the whole tree per game). Map each lower-cased exe name back to
  // the games that want it so a single found file can satisfy multiple games.
  const namesToGames = new Map<string, Array<{ key: string; game: typeof games[number]["game"] }>>();
  for (const { key, game } of gamesToScan) {
    const executableNames = GameExecutables.getExecutablesForGame(game.objectId);
    if (!executableNames || executableNames.length === 0) continue;
    for (const name of executableNames) {
      const lower = name.toLowerCase();
      const list = namesToGames.get(lower) ?? [];
      list.push({ key, game });
      namesToGames.set(lower, list);
    }
  }

  const wantedNames = new Set(namesToGames.keys());

  WindowManager.sendToAppWindows("on-scan-progress", {
    scanned: 0,
    total: gamesToScan.length,
    foundCount: 0,
    currentTitle: "Indexing installed games…",
  });

  const directories = discoverScanDirectories();
  logger.info(
    `[ScanInstalledGames] Scanning ${directories.length} director${directories.length === 1 ? "y" : "ies"} for ${wantedNames.size} executable name(s)`
  );

  const foundByName = await indexExecutables(directories, wantedNames);

  // Assign resolved paths back to games. Track seen keys so a game referenced by
  // several exe names is only written/reported once.
  const seenKeys = new Set<string>();
  let scanned = 0;
  for (const [name, foundPath] of foundByName) {
    for (const { key, game } of namesToGames.get(name) ?? []) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      scanned++;

      if (!dryRun) {
        await gamesSublevel.put(key, {
          ...game,
          // Resurrect a previously-deleted entry when it's found on disk again.
          isDeleted: false,
          executablePath: foundPath,
          // Found installed on disk = owned, not a catalogue-only entry
          libraryOrigin: "sync",
          isInstalledLocally: true,
        });
      }

      logger.info(
        `[ScanInstalledGames] Found executable for ${game.objectId}: ${foundPath}`
      );

      foundGames.push({ title: game.title, executablePath: foundPath, key });
      WindowManager.sendToAppWindows("on-scan-progress", {
        scanned,
        total: gamesToScan.length,
        foundCount: foundGames.length,
        currentTitle: game.title,
      });
    }
  }

  if (!dryRun) {
    void import("@main/services/achievements/exophase")
      .then((m) => m.applyCacheToLibrary())
      .catch(() => {});
    WindowManager.sendToAppWindows("on-library-batch-complete");
    await publishScanNotification(foundGames.length);
  }

  return { foundGames, total: gamesToScan.length };
};

registerEvent("scanInstalledGames", scanInstalledGames);
