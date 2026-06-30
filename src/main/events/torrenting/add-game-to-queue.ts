import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import {
  DownloadManager,
  DownloadOrchestrator,
  HydraApi,
  logger,
} from "@main/services";
import { createGame } from "@main/services/library-sync";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { parseBytes } from "@shared";
import {
  emulatorPlatformFolder,
  handleDownloadError,
  isKnownDownloadError,
  prepareGameEntry,
} from "@main/helpers";
import path from "node:path";
import type { EmulatorSystem } from "@types";

const addGameToQueue = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const {
    objectId,
    title,
    shop,
    downloader,
    uri,
    automaticallyExtract,
    automaticallyDeleteArchiveFiles,
    fileSize,
    fileIndices,
    selectedFilesSize,
    emulatorSystem,
  } = payload;

  const platformFolder = emulatorPlatformFolder(
    (emulatorSystem ?? null) as EmulatorSystem | null
  );
  const downloadPath = platformFolder
    ? path.join(payload.downloadPath, ...platformFolder.split("/"))
    : payload.downloadPath;

  const parsedFileSize = parseBytes(fileSize ?? null);
  const gameKey = levelKeys.game(shop, objectId);

  const download: Download = {
    shop,
    objectId,
    status: "paused",
    progress: 0,
    bytesDownloaded: 0,
    downloadPath,
    downloader,
    uri,
    folderName: null,
    fileSize: selectedFilesSize ?? parsedFileSize,
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    pinnedToHero: false,
    extracting: false,
    automaticallyExtract,
    automaticallyDeleteArchiveFiles,
    fileIndices,
    selectedFilesSize,
    emulatorSystem: emulatorSystem ?? null,
  };

  try {
    await DownloadManager.validateDownloadUrl(download);
  } catch (err: unknown) {
    if (isKnownDownloadError(err)) {
      logger.warn(
        "Failed to validate download URL for queue with expected download error",
        err
      );
    } else {
      logger.error("Failed to validate download URL for queue", err);
    }
    return handleDownloadError(err, downloader);
  }

  await prepareGameEntry({ gameKey, title, objectId, shop });

  try {
    await downloadsSublevel.put(gameKey, download);
    await DownloadOrchestrator.enqueuePreparedDownload(download);

    const updatedGame = await gamesSublevel.get(gameKey);

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ]);

    return { ok: true };
  } catch (err: unknown) {
    logger.error("Failed to add game to queue", err);

    if (err instanceof Error) {
      return { ok: false, error: err.message };
    }

    return { ok: false };
  }
};

registerEvent("addGameToQueue", addGameToQueue);
