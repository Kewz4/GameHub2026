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
  discoverUnknownGames,
  discoverGameLibraryRoots,
  discoverRomFiles,
} from "@main/helpers/scan-executables";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";
import type { EmulatorSystem } from "@types";

interface FoundGame {
  title: string;
  executablePath: string;
  key: string;
  /** True when this is a brand-new game discovered on disk (not yet in the
   *  library). Confirming it creates a fresh custom entry. */
  isNew?: boolean;
  /** Set when the game is a console/emulator ROM discovered by the scan.
   *  On confirm, the game is created with shop "launchbox" + the matching
   *  platform so it appears under the Console dropdown. */
  emulatorSystem?: EmulatorSystem;
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
  const namesToGames = new Map<
    string,
    Array<{ key: string; game: (typeof games)[number]["game"] }>
  >();
  for (const { key, game } of gamesToScan) {
    const executableNames = GameExecutables.getExecutablesForGame(
      game.objectId
    );
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

  // ── Discover NEW games on disk (not yet in the library) ──────────────────
  // Deep scan also surfaces games found on disk that aren't in the library at
  // all — but only outside store-managed folders (Steam/Epic/GOG/Xbox), since
  // those titles are owned by their platform integrations.
  const knownExePaths = new Set(
    games
      .map((g) => g.game.executablePath?.toLowerCase())
      .filter((p): p is string => Boolean(p))
  );
  const knownTitles = new Set(
    games.map((g) => normalizeGameTitle(g.game.title))
  );

  // Map normalized title → an existing library entry that is in the library but
  // has NO resolved executable yet. These are games the first (exe-name) phase
  // couldn't resolve because their executable names aren't in the executables
  // DB. When disk discovery finds a folder whose title matches one of these, we
  // resolve the existing entry's executablePath instead of skipping it as a
  // "known title" — this is how titles like Neon Abyss get picked up.
  const unresolvedByTitle = new Map<
    string,
    { key: string; game: (typeof games)[number]["game"] }
  >();
  for (const { key, game } of games) {
    if (game.executablePath && !game.isDeleted) continue;
    const norm = normalizeGameTitle(game.title);
    if (!unresolvedByTitle.has(norm))
      unresolvedByTitle.set(norm, { key, game });
  }

  const discoveryRoots = discoverGameLibraryRoots();
  const discovered = await discoverUnknownGames(
    discoveryRoots,
    (current, total, title) =>
      WindowManager.sendToAppWindows("on-scan-progress", {
        scanned: current,
        total,
        foundCount: foundGames.length,
        currentTitle: title,
      })
  );

  const seenNewPaths = new Set<string>();
  for (const game of discovered) {
    const exeLower = game.executablePath.toLowerCase();
    if (knownExePaths.has(exeLower) || seenNewPaths.has(exeLower)) continue;
    seenNewPaths.add(exeLower);

    const norm = normalizeGameTitle(game.title);

    // Folder matches an existing-but-unresolved library entry (e.g. an owned
    // game whose exe names aren't in the executables DB). Resolve THAT entry's
    // executable rather than treating it as a brand-new custom game.
    const unresolved = unresolvedByTitle.get(norm);
    if (unresolved) {
      if (!seenKeys.has(unresolved.key)) {
        seenKeys.add(unresolved.key);
        if (!dryRun) {
          await gamesSublevel.put(unresolved.key, {
            ...unresolved.game,
            isDeleted: false,
            executablePath: game.executablePath,
            isInstalledLocally: true,
          });
        }
        foundGames.push({
          title: unresolved.game.title,
          executablePath: game.executablePath,
          key: unresolved.key,
        });
        logger.info(
          `[ScanInstalledGames] Resolved unresolved library entry by folder match: ${unresolved.game.title} → ${game.executablePath}`
        );
      }
      continue;
    }

    // Already in the library with a different title-resolved entry — skip.
    if (knownTitles.has(norm)) continue;

    foundGames.push({
      title: game.title,
      executablePath: game.executablePath,
      // Synthetic key — used only for renderer keying/toggling. The real custom
      // entry is created at confirm time from title + executablePath.
      key: `new:${exeLower}`,
      isNew: true,
    });
  }

  // ── Phase 3: Discover emulator/console ROM files on disk ──────────────────
  // The deep scan also looks for ROM files (.iso, .3ds, .gba, etc.) in the
  // "Emulator Games" folders and generic ROM directories. Found ROMs that
  // aren't already in the library are surfaced for the user to confirm.
  const knownRomPaths = new Set(
    games
      .filter((g) => g.game.shop === "launchbox")
      .map((g) => g.game.executablePath?.toLowerCase())
      .filter((p): p is string => Boolean(p))
  );

  const discoveredRoms = await discoverRomFiles([], (current, total, title) =>
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

    // Check if this ROM matches an existing (possibly deleted) launchbox entry
    // by title — if so, resolve its executable path instead of creating new.
    const existingRom = games.find(
      (g) =>
        g.game.shop === "launchbox" &&
        normalizeGameTitle(g.game.title) === romNorm
    );
    if (existingRom) {
      if (!seenKeys.has(existingRom.key)) {
        seenKeys.add(existingRom.key);
        if (!dryRun) {
          await gamesSublevel.put(existingRom.key, {
            ...existingRom.game,
            isDeleted: false,
            executablePath: rom.romPath,
            isInstalledLocally: true,
          });
        }
        foundGames.push({
          title: existingRom.game.title,
          executablePath: rom.romPath,
          key: existingRom.key,
        });
        logger.info(
          `[ScanInstalledGames] Resolved ROM: ${existingRom.game.title} → ${rom.romPath}`
        );
      }
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
    void import("@main/services/achievements/exophase")
      .then((m) => m.applyCacheToLibrary())
      .catch(() => {});
    WindowManager.sendToAppWindows("on-library-batch-complete");
    await publishScanNotification(foundGames.length);
  }

  return { foundGames, total: gamesToScan.length };
};

registerEvent("scanInstalledGames", scanInstalledGames);
