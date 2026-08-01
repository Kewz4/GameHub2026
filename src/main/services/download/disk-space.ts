import checkDiskSpace from "check-disk-space";
import { MINIMUM_FREE_DISK_SPACE_BYTES } from "@shared";
import type { Download } from "@types";

/**
 * Free space is re-read on a timer rather than on every progress tick: the
 * check touches the filesystem and progress fires several times a second.
 */
export const DISK_SPACE_CHECK_INTERVAL_MS = 10_000;

export interface DownloadDiskSpace {
  freeBytes: number;
  requiredBytes: number;
  hasEnoughSpace: boolean;
}

/** Bytes still to fetch — a resumed download only needs the remainder. */
const getRemainingBytes = (download: Download) => {
  const fileSize = download.selectedFilesSize ?? download.fileSize ?? 0;
  if (fileSize <= 0) return 0;
  return Math.max(0, fileSize - (download.bytesDownloaded ?? 0));
};

export const getDownloadDiskSpace = async (
  download: Download
): Promise<DownloadDiskSpace | null> => {
  try {
    const { free } = await checkDiskSpace(download.downloadPath);

    // An unknown file size still has to clear the headroom, so a download of
    // indeterminate size cannot start onto an already-full drive.
    const requiredBytes = Math.max(
      getRemainingBytes(download),
      MINIMUM_FREE_DISK_SPACE_BYTES
    );

    return {
      freeBytes: free,
      requiredBytes,
      hasEnoughSpace: free >= requiredBytes,
    };
  } catch {
    // An unreadable path (removed drive, permissions) must not be treated as
    // "full" — the caller carries on and the download fails on its own terms.
    return null;
  }
};
