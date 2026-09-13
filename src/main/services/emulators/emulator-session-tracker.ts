import type { ChildProcess } from "node:child_process";
import { gamesSublevel, levelKeys } from "@main/level";
import type { Game, EmulatorSystem, GameShop } from "@types";
import { logger } from "../logger";
import { setEmulatorGameRunning } from "../process-watcher";
import { runAutomaticCloudSaveAfterExit } from "../cloud-save/automatic-sync-lifecycle";
import { markCloudSaveLaunchSessionRunning } from "../cloud-save/launch-guard";
import { createSingleRunFinalizer } from "./single-run-finalizer";

interface SessionOptions {
  game: Game;
  system: EmulatorSystem;
  executablePath: string;
  sku: string | null;
  child: ChildProcess;
}

/** Live emulator child processes, keyed by game level-key, for close/kill. */
const activeSessions = new Map<string, ChildProcess>();

export const startEmulatorSession = async (
  opts: SessionOptions
): Promise<void> => {
  const { game, child } = opts;
  const startTime = Date.now();
  const key = levelKeys.game(game.shop, game.objectId);

  // Mark the game as running so the Play button becomes Close while open.
  activeSessions.set(key, child);
  setEmulatorGameRunning(key, true);
  const cloudSaveSessionToken = markCloudSaveLaunchSessionRunning(
    game.objectId,
    game.shop
  )?.token;

  const finalize = createSingleRunFinalizer(async () => {
    // A failed spawn can emit both error and exit/close. The same child must
    // never add playtime or run a post-exit cloud upload twice.
    const isCurrentSession = activeSessions.get(key) === child;
    if (isCurrentSession) {
      activeSessions.delete(key);
      setEmulatorGameRunning(key, false);
    }

    try {
      const stored = await gamesSublevel.get(key).catch(() => null);
      if (!stored) return;
      const elapsed = Date.now() - startTime;
      await gamesSublevel.put(key, {
        ...stored,
        playTimeInMilliseconds: (stored.playTimeInMilliseconds ?? 0) + elapsed,
        lastTimePlayed: new Date(),
      });

      // If a newer session replaced this child, let that session own the final
      // upload so saves are never scanned while the emulator is still writing.
      if (isCurrentSession) {
        await runAutomaticCloudSaveAfterExit(
          stored.objectId,
          stored.shop,
          cloudSaveSessionToken
        );
      }
    } catch (err) {
      logger.error("Failed to finalize emulator session", {
        gameKey: key,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const scheduleFinalize = () => void finalize();
  child.once("exit", scheduleFinalize);
  child.once("error", scheduleFinalize);

  // Handle a child which terminated before the listeners were attached.
  if (child.exitCode !== null || child.signalCode !== null) {
    scheduleFinalize();
  }
};

/**
 * Kill the emulator process launched for a game, if one is tracked. Returns
 * true when a session was found and a kill was issued.
 */
export const closeEmulatorSession = (
  shop: GameShop,
  objectId: string
): boolean => {
  const key = levelKeys.game(shop, objectId);
  const child = activeSessions.get(key);
  if (!child) return false;
  try {
    // Detached spawns get a process group on POSIX — kill the group; on Windows
    // a plain kill terminates the emulator process.
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    } else {
      child.kill();
    }
  } catch (err) {
    logger.error("Failed to close emulator session", err);
  }
  // Keep the session registered until its terminal event so the single
  // finalizer can persist playtime and run the selected cloud-save backend.
  return true;
};
