import { registerEvent } from "../register-event";
import { PythonRPC } from "@main/services/python-rpc";
import type { TorrentFilesResponse } from "@types";
import { DownloadError } from "@shared";
import { logger } from "@main/services";
import {
  isTorrentFileUri,
  ensureLocalTorrentFile,
  parseLocalTorrentFile,
} from "@main/services/download/torrent-file";

const mapTorrentFilesError = (error: unknown) => {
  const rpcError =
    typeof error === "object" && error !== null && "response" in error
      ? ((error as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? undefined)
      : undefined;

  if (rpcError) {
    switch (rpcError) {
      case "invalid_magnet":
        return DownloadError.InvalidMagnet;
      case "metadata_timeout":
        return DownloadError.TorrentMetadataTimeout;
      case "metadata_incomplete":
        return DownloadError.TorrentMetadataIncomplete;
      case "too_many_files":
        return DownloadError.TorrentTooManyFiles;
      case "metadata_busy":
        return DownloadError.TorrentMetadataTimeout;
      default:
        return DownloadError.TorrentFilesUnavailable;
    }
  }

  if (error instanceof Error) {
    return DownloadError.TorrentFilesUnavailable;
  }

  return DownloadError.TorrentFilesUnavailable;
};

const getTorrentFiles = async (
  _event: Electron.IpcMainInvokeEvent,
  magnet: string
) => {
  if (!magnet || typeof magnet !== "string") {
    return { ok: false, error: DownloadError.InvalidMagnet };
  }

  // Direct .torrent link (Minerva collection torrents): the full file list is
  // one HTTPS fetch away — parsed right here, no peer metadata exchange.
  if (isTorrentFileUri(magnet)) {
    try {
      const localPath = await ensureLocalTorrentFile(magnet);
      const parsed = await parseLocalTorrentFile(localPath);
      return {
        ok: true,
        data: {
          infoHash: parsed.infoHash,
          name: parsed.name,
          totalSize: parsed.totalSize,
          files: parsed.files,
        },
      };
    } catch (error) {
      logger.error("[getTorrentFiles] .torrent fetch/parse failed:", error);
      return { ok: false, error: DownloadError.TorrentFilesUnavailable };
    }
  }

  if (!magnet.startsWith("magnet:")) {
    return { ok: false, error: DownloadError.InvalidMagnet };
  }

  try {
    const response = await PythonRPC.rpc.call<TorrentFilesResponse>(
      "torrent_files",
      {
        magnet,
        timeout_ms: 45_000,
      },
      {
        timeout: 45000,
      }
    );

    return {
      ok: true,
      data: response.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: mapTorrentFilesError(error),
    };
  }
};

registerEvent("getTorrentFiles", getTorrentFiles);
