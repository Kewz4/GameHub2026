import type { ChildProcess } from "node:child_process";
import { gamesSublevel, levelKeys } from "@main/level";
import type { Game, EmulatorSystem, GameShop } from "@types";
import { logger } from "../logger";
import { setEmulatorGameRunning } from "../process-watcher";

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

  child.once("exit", async () => {
    activeSessions.delete(key);
    setEmulatorGameRunning(key, false);
    try {
      const stored = await gamesSublevel.get(key).catch(() => null);
      if (!stored) return;
      const elapsed = Date.now() - startTime;
      await gamesSublevel.put(key, {
        ...stored,
        playTimeInMilliseconds: (stored.playTimeInMilliseconds ?? 0) + elapsed,
        lastTimePlayed: new Date(),
      });
    } catch (err) {
      logger.error("Failed to persist emulator session playtime", err);
    }
  });
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
  activeSessions.delete(key);
  setEmulatorGameRunning(key, false);
  return true;
};
