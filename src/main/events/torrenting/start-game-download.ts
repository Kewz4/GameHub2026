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
import {
  emulatorPlatformFolder,
  handleDownloadError,
  isKnownDownloadError,
  prepareGameEntry,
} from "@main/helpers";
import path from "node:path";
import type { EmulatorSystem } from "@types";

export const startGameDownloadImpl = async (
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
    fileIndices,
    selectedFilesSize,
    targetFileName,
    alternateUris,
    emulatorSystem,
    libraryOrigin,
  } = payload;

  // Console/emulator downloads are grouped under "Emulator Games/<platform>"
  // instead of inheriting the torrent's own directory tree (which produced
  // paths like ...\Minerva_Myrient\No-Intro\Source\).
  const platformFolder = emulatorPlatformFolder(
    (emulatorSystem ?? null) as EmulatorSystem | null
  );
  const downloadPath = platformFolder
    ? path.join(payload.downloadPath, ...platformFolder.split("/"))
    : payload.downloadPath;

  const gameKey = levelKeys.game(shop, objectId);

  logger.log(
    `[Downloads] Start requested for ${gameKey} (downloader=${downloader})`
  );

  await prepareGameEntry({
    gameKey,
    title,
    objectId,
    shop,
    libraryOrigin:
      libraryOrigin ?? (payload.customDownload ? "custom" : undefined),
  });
  await DownloadManager.cancelDownload(gameKey);

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
    shouldSeed: false,
    timestamp: Date.now(),
    queued: true,
    pinnedToHero: false,
    extracting: false,
    automaticallyExtract,
    automaticallyDeleteArchiveFiles,
    fileIndices,
    selectedFilesSize,
    targetFileName,
    alternateUris,
    fileSize: selectedFilesSize ?? null,
    emulatorSystem: emulatorSystem ?? null,
    customDownload: payload.customDownload,
  };

  try {
    await downloadsSublevel.put(gameKey, download);
    await DownloadOrchestrator.startPreparedDownload(download);

    const updatedGame = await gamesSublevel.get(gameKey);

    // Companion downloads (::update / ::dlc) are download-tracking entries, not
    // real games — never sync them to the remote library.
    if (!objectId.includes("::")) {
      await Promise.all([
        createGame(updatedGame!).catch(() => {}),
        HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
          needsAuth: false,
        }).catch(() => {}),
      ]);
    }

    return { ok: true };
  } catch (err: unknown) {
    await downloadsSublevel.del(gameKey).catch(() => null);
    await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId });

    if (isKnownDownloadError(err)) {
      logger.warn("Failed to start download with expected download error", err);
    } else {
      logger.error("Failed to start download", err);
    }
    return handleDownloadError(err, downloader);
  }
};

const startGameDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => startGameDownloadImpl(payload);

registerEvent("startGameDownload", startGameDownload);
