import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import axios from "axios";
import parseTorrent from "parse-torrent";
import { app } from "electron";
import { logger } from "../logger";

/**
 * Support for repacks whose URI is a direct HTTPS link to a `.torrent` file
 * (Minerva collection torrents). Downloading the .torrent over HTTPS gives the
 * client the FULL file list instantly — no BitTorrent metadata exchange, no
 * debrid cache — so one exact file can be selected out of a shared collection
 * torrent deterministically. This is what fixes "asked for Twilight Princess,
 * got Wind Waker": file selection happens against the real torrent, up front.
 */

export const isTorrentFileUri = (uri: string): boolean =>
  /^https?:\/\/.+\.torrent(\?.*)?$/i.test(uri);

const torrentCacheDir = () =>
  path.join(app.getPath("userData"), "torrent-files");

/**
 * Download (or reuse a cached copy of) a .torrent file. Cached by URL hash so
 * resumes and seeding restarts after an app restart don't re-fetch it.
 */
export async function ensureLocalTorrentFile(uri: string): Promise<string> {
  const dir = torrentCacheDir();
  const filename =
    crypto.createHash("sha1").update(uri).digest("hex") + ".torrent";
  const localPath = path.join(dir, filename);

  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
    return localPath;
  }

  await fs.promises.mkdir(dir, { recursive: true });

  logger.log(`[torrent-file] downloading .torrent from ${uri}`);
  const response = await axios.get<ArrayBuffer>(uri, {
    responseType: "arraybuffer",
    timeout: 120_000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const buffer = Buffer.from(response.data);
  // Bencoded dictionaries start with "d" — reject HTML error pages.
  if (buffer.length === 0 || buffer[0] !== 0x64) {
    throw new Error(`Invalid .torrent payload from ${uri}`);
  }

  const tempPath = localPath + ".tmp";
  await fs.promises.writeFile(tempPath, buffer);
  await fs.promises.rename(tempPath, localPath);
  logger.log(
    `[torrent-file] cached .torrent (${buffer.length} bytes) at ${localPath}`
  );
  return localPath;
}

export interface TorrentFileEntry {
  index: number;
  path: string;
  length: number;
}

export interface ParsedTorrentFile {
  name: string;
  infoHash: string;
  totalSize: number;
  files: TorrentFileEntry[];
}

/** Parse a local .torrent into the same shape the torrent-files RPC returns. */
export async function parseLocalTorrentFile(
  localPath: string
): Promise<ParsedTorrentFile> {
  const buffer = await fs.promises.readFile(localPath);
  // A .torrent buffer always parses to a torrent-file instance (the magnet-uri
  // variant only comes from string inputs).
  const torrent = (await parseTorrent(buffer)) as {
    name?: string | string[];
    infoHash?: string;
    length?: number;
    files?: Array<{ path: string; length: number }>;
  };

  const files = (torrent.files ?? []).map((file, index) => ({
    index,
    path: file.path,
    length: file.length,
  }));

  const name = Array.isArray(torrent.name)
    ? (torrent.name[0] ?? "")
    : (torrent.name ?? "");

  return {
    name,
    infoHash: torrent.infoHash ?? "",
    totalSize:
      torrent.length ?? files.reduce((sum, file) => sum + file.length, 0),
    files,
  };
}

/**
 * Find the index of the repack's exact file inside the torrent. Exact basename
 * match first; a normalized contains-match as fallback (filenames occasionally
 * differ by punctuation between the catalogue and the torrent).
 */
export function resolveTorrentFileIndex(
  files: TorrentFileEntry[],
  targetFileName: string
): TorrentFileEntry | null {
  const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const wanted = targetFileName.trim().toLowerCase();
  const exact = files.find((f) => basename(f.path).toLowerCase() === wanted);
  if (exact) return exact;

  const norm = (s: string) =>
    basename(s)
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, "")
      .replace(/[^a-z0-9]/g, "");
  const want = norm(wanted);
  return (
    files.find((f) => norm(f.path) === want) ??
    files.find((f) => norm(f.path).includes(want)) ??
    null
  );
}
