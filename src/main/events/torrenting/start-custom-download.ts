import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  classifyCustomDownloadSource,
  Downloader,
  isDirectExecutableUrl,
  normalizeCustomDownloadTitle,
} from "@shared";
import type {
  StartCustomDownloadPayload,
  StartCustomDownloadResult,
  UserPreferences,
} from "@types";
import { logger } from "@main/services";
import { db, levelKeys } from "@main/level";
import {
  cacheLocalTorrentFile,
  ensureLocalTorrentFile,
} from "@main/services/download/torrent-file";
import { DownloadManager } from "@main/services/download/download-manager";
import { TorBoxClient } from "@main/services/download/torbox";
import { assertPublicRemoteUrlSyntax } from "@main/services/download/remote-url-safety";
import { registerEvent } from "../register-event";
import { startGameDownloadImpl } from "./start-game-download";

async function prepareSource(payload: StartCustomDownloadPayload) {
  if (payload.localTorrentPath) {
    const cached = await cacheLocalTorrentFile(payload.localTorrentPath);
    return {
      uri: cached.path,
      sourceType: "torrent" as const,
      fileSize: cached.totalSize,
      isRawExecutable: false,
    };
  }

  const classified = classifyCustomDownloadSource(payload.source);
  if (classified.type === "link") {
    assertPublicRemoteUrlSyntax(classified.value);
  }
  if (classified.remoteTorrentFile) {
    const localPath = await ensureLocalTorrentFile(classified.value);
    const cached = await cacheLocalTorrentFile(localPath);
    return {
      uri: cached.path,
      sourceType: "torrent" as const,
      fileSize: cached.totalSize,
      isRawExecutable: false,
    };
  }

  return {
    uri: classified.value,
    sourceType: classified.type,
    fileSize: null,
    isRawExecutable: isDirectExecutableUrl(classified.value),
  };
}

const startCustomDownload = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartCustomDownloadPayload
): Promise<StartCustomDownloadResult> => {
  try {
    const title = normalizeCustomDownloadTitle(payload.title);
    if (!payload.downloadPath?.trim()) {
      throw new Error("Choose a download folder");
    }

    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    const torBoxApiToken = userPreferences?.torBoxApiToken?.trim();
    if (!torBoxApiToken) {
      throw new Error(
        "Connect TorBox in Settings > Integrations before adding a custom download"
      );
    }

    // Re-authorize at submission time. This avoids a startup race where the
    // renderer is ready before loadState has initialized the persisted token.
    TorBoxClient.authorize(torBoxApiToken);

    if (!path.isAbsolute(payload.downloadPath)) {
      throw new Error("Choose an absolute download folder");
    }
    const downloadPath = path.resolve(payload.downloadPath);
    await fs.promises.mkdir(downloadPath, { recursive: true });
    const downloadPathStats = await fs.promises.stat(downloadPath);
    if (!downloadPathStats.isDirectory()) {
      throw new Error("The selected download location is not a folder");
    }

    const source = await prepareSource(payload);
    const objectId = `custom-download-${crypto.randomUUID()}`;
    const queued = DownloadManager.hasActiveDownload();
    const response = await startGameDownloadImpl({
      objectId,
      title,
      shop: "custom",
      downloader: Downloader.TorBox,
      uri: source.uri,
      downloadPath,
      automaticallyExtract:
        payload.automaticallyExtract && !source.isRawExecutable,
      automaticallyDeleteArchiveFiles: payload.automaticallyDeleteArchiveFiles,
      selectedFilesSize: source.fileSize,
      customDownload: { sourceType: source.sourceType },
    });

    return response.ok
      ? { ok: true, objectId, shop: "custom", queued }
      : response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start the download";
    logger.error(
      `[CustomDownload] Failed to submit TorBox download: ${message}`
    );
    return { ok: false, error: message };
  }
};

registerEvent("startCustomDownload", startCustomDownload);
