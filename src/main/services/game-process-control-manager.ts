import type { Game, GameProcessControlState } from "@types";
import { app, BrowserWindow } from "electron";
import path from "node:path";

import { findOverlayGameProcesses } from "./overlay-game-process";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

const idleState = (): GameProcessControlState => ({
  status: "idle",
  shop: null,
  objectId: null,
  gameTitle: null,
  rootPid: 0,
  processCount: 0,
  canPause: false,
  canResume: false,
  canClose: false,
  message: null,
  updatedAt: Date.now(),
});

const gameKey = (game: Game) => `${game.shop}:${game.objectId}`;

export class GameProcessControlManager {
  private static initialized = false;
  private static state = idleState();
  private static pausedGameKey: string | null = null;
  private static pausedGame: Game | null = null;
  private static pausedRootPid = 0;
  private static operationQueue: Promise<void> = Promise.resolve();

  public static initialize() {
    if (this.initialized) return;
    this.initialized = true;
    app.once("before-quit", () => this.resumeBeforeExit());
  }

  public static async getState(
    game: Game | null,
    targetPid: number
  ): Promise<GameProcessControlState> {
    if (this.pausedRootPid) {
      if (await this.isProcessRunning(this.pausedRootPid)) {
        const sessionGame = this.pausedGame ?? game;
        if (
          this.state.status === "paused" &&
          this.state.rootPid === this.pausedRootPid
        ) {
          return this.state;
        }
        if (sessionGame) {
          return this.setForGame(
            sessionGame,
            "paused",
            this.pausedRootPid,
            Math.max(1, this.state.processCount),
            this.state.message ??
              "Game processes are paused. Resume them from the overlay or launcher."
          );
        }
        return this.state;
      }
      this.clearPausedTarget();
    }

    if (!game) {
      this.setState(idleState());
      return this.state;
    }
    if (!targetPid) {
      return this.setForGame(
        game,
        "waiting",
        0,
        0,
        "Waiting for the game's render process."
      );
    }
    return this.setForGame(game, "running", targetPid, 1, null);
  }

  public static pause(game: Game | null, targetPid: number) {
    return this.enqueue(async () => {
      if (!game) {
        return this.fail(null, 0, "No active game is available to pause.");
      }
      if (this.pausedRootPid) {
        if (await this.isProcessRunning(this.pausedRootPid)) {
          if (this.pausedGameKey === gameKey(game)) return this.state;
          return this.setForGame(
            this.pausedGame ?? game,
            "paused",
            this.pausedRootPid,
            Math.max(1, this.state.processCount),
            "Resume the currently paused game before pausing another game."
          );
        }
        this.clearPausedTarget();
      }

      const validationError = await this.validateTarget(game, targetPid);
      if (validationError) return this.fail(game, targetPid, validationError);

      const result = NativeAddon.controlProcessTree(targetPid, "suspend");
      if (result.unsupported) {
        return this.setForGame(
          game,
          "unavailable",
          targetPid,
          0,
          result.error ?? "Game pause is unavailable on this platform."
        );
      }
      if (result.failedPids.length || !result.succeededPids.length) {
        // Never leave a partially-suspended tree behind. Resume is idempotent,
        // so it is safe to apply to the whole root after a partial failure.
        if (result.succeededPids.length) {
          const rollback = NativeAddon.controlProcessTree(targetPid, "resume");
          if (
            rollback.failedPids.length &&
            (await this.isProcessRunning(targetPid))
          ) {
            this.pausedGameKey = gameKey(game);
            this.pausedGame = game;
            this.pausedRootPid = targetPid;
            return this.setForGame(
              game,
              "paused",
              targetPid,
              result.succeededPids.length,
              "Some game processes could not be restored automatically. Use Resume to retry before closing GameHub."
            );
          }
        }
        return this.fail(
          game,
          targetPid,
          "GameHub could not pause every game process. Administrator or anti-cheat protection may be blocking access."
        );
      }

      this.pausedGameKey = gameKey(game);
      this.pausedGame = game;
      this.pausedRootPid = targetPid;
      logger.info("Active game process tree paused", {
        game: this.pausedGameKey,
        rootPid: targetPid,
        processCount: result.succeededPids.length,
      });
      return this.setForGame(
        game,
        "paused",
        targetPid,
        result.succeededPids.length,
        "Game processes are paused. Resume them from the overlay or launcher."
      );
    });
  }

  public static resume(game: Game | null) {
    return this.enqueue(async () => {
      const sessionGame = this.pausedGame ?? game;
      const rootPid = this.pausedRootPid;
      if (!sessionGame || !rootPid) {
        return this.fail(
          sessionGame,
          rootPid,
          "No paused active game is available to resume."
        );
      }
      if (this.pausedGameKey && this.pausedGameKey !== gameKey(sessionGame)) {
        return this.fail(
          sessionGame,
          rootPid,
          "The paused process belongs to a different game session."
        );
      }

      const result = NativeAddon.controlProcessTree(rootPid, "resume");
      const stillRunning = await this.isProcessRunning(rootPid);
      if (
        result.unsupported ||
        (result.failedPids.length && stillRunning) ||
        (!result.succeededPids.length && stillRunning)
      ) {
        this.pausedGameKey = gameKey(sessionGame);
        this.pausedGame = sessionGame;
        this.pausedRootPid = rootPid;
        logger.warn("Active game process resume failed", {
          game: this.pausedGameKey,
          rootPid,
          failedPids: result.failedPids,
        });
        return this.setForGame(
          sessionGame,
          "paused",
          rootPid,
          Math.max(1, this.state.processCount),
          result.error ??
            "GameHub could not resume every process in the game session."
        );
      }

      this.clearPausedTarget();
      logger.info("Active game process tree resumed", {
        game: gameKey(sessionGame),
        rootPid,
        processCount: result.succeededPids.length,
      });
      return this.setForGame(
        sessionGame,
        stillRunning ? "running" : "stopped",
        stillRunning ? rootPid : 0,
        stillRunning ? result.succeededPids.length : 0,
        null
      );
    });
  }

  public static close(game: Game | null, targetPid: number) {
    return this.enqueue(async () => {
      const sessionGame = this.pausedRootPid ? (this.pausedGame ?? game) : game;
      if (!sessionGame) {
        return this.fail(null, 0, "No active game is available to close.");
      }
      if (this.pausedGameKey && this.pausedGameKey !== gameKey(sessionGame)) {
        return this.fail(
          sessionGame,
          this.pausedRootPid,
          "The paused process belongs to a different game session."
        );
      }
      const rootPid =
        this.pausedGameKey === gameKey(sessionGame) && this.pausedRootPid
          ? this.pausedRootPid
          : targetPid;
      if (!rootPid) {
        return this.fail(
          sessionGame,
          0,
          "The active game process is no longer running."
        );
      }
      if (!this.pausedRootPid) {
        const validationError = await this.validateTarget(sessionGame, rootPid);
        if (validationError) {
          return this.fail(sessionGame, rootPid, validationError);
        }
      }

      const result = NativeAddon.controlProcessTree(rootPid, "terminate");
      const alivePids = await this.runningPids(result.failedPids);
      if (
        result.unsupported ||
        alivePids.length ||
        (!result.succeededPids.length && (await this.isProcessRunning(rootPid)))
      ) {
        if (this.pausedRootPid) {
          return this.setForGame(
            sessionGame,
            "paused",
            rootPid,
            Math.max(1, this.state.processCount),
            result.error ??
              "GameHub could not close every process in the game session."
          );
        }
        return this.fail(
          sessionGame,
          rootPid,
          result.error ??
            "GameHub could not close every process in the game session."
        );
      }

      this.clearPausedTarget();
      logger.info("Active game process tree closed", {
        game: gameKey(sessionGame),
        rootPid,
        processCount: result.succeededPids.length,
      });
      return this.setForGame(
        sessionGame,
        "stopped",
        0,
        0,
        "The game was closed."
      );
    });
  }

  private static enqueue(
    operation: () => Promise<GameProcessControlState>
  ): Promise<GameProcessControlState> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private static async validateTarget(game: Game, targetPid: number) {
    if (!Number.isInteger(targetPid) || targetPid <= 4) {
      return "GameHub could not resolve a safe game process target.";
    }
    if (targetPid === process.pid) {
      return "GameHub refused to control its own process.";
    }

    const candidates = await findOverlayGameProcesses(game, targetPid, true);
    const candidate = candidates.find((process) => process.pid === targetPid);
    if (!candidate) {
      return "The selected process no longer belongs to the active game.";
    }
    if (
      candidate.exe &&
      path.normalize(candidate.exe).toLowerCase() ===
        path.normalize(process.execPath).toLowerCase()
    ) {
      return "GameHub refused to control its own executable.";
    }
    return null;
  }

  private static async isProcessRunning(pid: number) {
    return (await this.runningPids([pid])).length > 0;
  }

  private static async runningPids(pids: number[]) {
    if (!pids.length) return [];
    const expected = new Set(pids);
    return (await NativeAddon.listProcesses())
      .filter((process) => expected.has(process.pid))
      .map((process) => process.pid);
  }

  private static fail(game: Game | null, rootPid: number, message: string) {
    logger.warn("Active game process control failed", {
      game: game ? gameKey(game) : null,
      rootPid,
      message,
    });
    return this.setForGame(game, "error", rootPid, 0, message);
  }

  private static setForGame(
    game: Game | null,
    status: GameProcessControlState["status"],
    rootPid: number,
    processCount: number,
    message: string | null
  ) {
    return this.setState({
      status,
      shop: game?.shop ?? null,
      objectId: game?.objectId ?? null,
      gameTitle: game?.title ?? null,
      rootPid,
      processCount,
      canPause:
        process.platform === "win32" && status === "running" && rootPid > 0,
      canResume:
        process.platform === "win32" && status === "paused" && rootPid > 0,
      canClose:
        process.platform === "win32" &&
        ["running", "paused"].includes(status) &&
        rootPid > 0,
      message,
      updatedAt: Date.now(),
    });
  }

  private static setState(state: GameProcessControlState) {
    this.state = state;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("on-game-process-control-state", state);
      }
    }
    return state;
  }

  private static clearPausedTarget() {
    this.pausedGameKey = null;
    this.pausedGame = null;
    this.pausedRootPid = 0;
  }

  private static resumeBeforeExit() {
    if (!this.pausedRootPid) return;
    const rootPid = this.pausedRootPid;
    const result = NativeAddon.controlProcessTree(rootPid, "resume");
    if (result.failedPids.length) {
      logger.error("Could not resume all paused game processes before exit", {
        rootPid,
        failedPids: result.failedPids,
      });
    }
    this.clearPausedTarget();
  }
}
