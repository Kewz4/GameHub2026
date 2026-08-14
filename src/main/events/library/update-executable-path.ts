import { registerEvent } from "../register-event";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { getDirectorySize } from "../helpers/get-directory-size";
import { findGameRootFromExe } from "../helpers/find-game-root";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import type { GameShop } from "@types";
import { enqueueGameRecordMutation } from "./game-record-mutation-queue";

const updateExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string | null
) => {
  const parsedPath = executablePath
    ? parseExecutablePath(executablePath)
    : null;

  const gameKey = levelKeys.game(shop, objectId);

  await enqueueGameRecordMutation(gameKey, async () => {
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    // Update immediately without size so UI responds fast. Sharing this queue
    // with post-installer discovery guarantees an explicit user selection wins
    // over an in-flight automatic match.
    await gamesSublevel.put(gameKey, {
      ...game,
      executablePath: parsedPath,
      installedSizeInBytes: parsedPath ? game.installedSizeInBytes : null,
      automaticCloudSync:
        executablePath === null ? false : game.automaticCloudSync,
    });
  });

  // Calculate size in background and update later
  if (parsedPath) {
    findGameRootFromExe(parsedPath)
      .then(async (gameRoot) => {
        if (!gameRoot) {
          logger.warn(`Could not determine game root for: ${parsedPath}`);
          return;
        }

        logger.log(`Game root detected: ${gameRoot} (exe: ${parsedPath})`);

        const installedSizeInBytes = await getDirectorySize(gameRoot);

        await enqueueGameRecordMutation(gameKey, async () => {
          const currentGame = await gamesSublevel.get(gameKey);
          if (!currentGame || currentGame.executablePath !== parsedPath) return;

          await gamesSublevel.put(gameKey, {
            ...currentGame,
            installedSizeInBytes,
          });
        });
      })
      .catch((err) => {
        logger.error(`Failed to calculate game size: ${err}`);
      });
  }
};

registerEvent("updateExecutablePath", updateExecutablePath);

const updateTrackingExecutablePaths = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  trackingExecutablePaths: string[]
) => {
  const parsedPaths = trackingExecutablePaths.map((trackingExecutablePath) =>
    parseExecutablePath(trackingExecutablePath)
  );

  const gameKey = levelKeys.game(shop, objectId);

  await enqueueGameRecordMutation(gameKey, async () => {
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    await gamesSublevel.put(gameKey, {
      ...game,
      trackingExecutablePaths: parsedPaths,
      trackingExecutablePathsUpdatedAt: parsedPaths.length ? new Date() : null,
    });
  });
};

registerEvent("updateTrackingExecutablePaths", updateTrackingExecutablePaths);
