import type { ChildProcess } from "node:child_process";
import { gamesSublevel, levelKeys } from "@main/level";
import type { Game, EmulatorSystem } from "@types";
import { logger } from "../logger";

interface SessionOptions {
  game: Game;
  system: EmulatorSystem;
  executablePath: string;
  sku: string | null;
  child: ChildProcess;
}

export const startEmulatorSession = async (opts: SessionOptions): Promise<void> => {
  const { game, child } = opts;
  const startTime = Date.now();

  child.once("exit", async () => {
    try {
      const key = levelKeys.game(game.shop, game.objectId);
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
