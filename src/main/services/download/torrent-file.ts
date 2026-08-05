import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import axios from "axios";
import parseTorrent from "parse-torrent";
import { app } from "electron";
import { logger } from "../logger";
import {
  assertPublicRemoteUrlSyntax,
  createPublicDownloadAgents,
} from "./remote-url-safety";

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

const MAX_TORRENT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TORRENT_REDIRECTS = 5;

interface ValidatedTorrent {
  infoHash: string;
  name?: string | string[];
  length?: number;
  files?: Array<{ path: string; length: number }>;
}

function getLogSafeRemoteUrl(uri: string) {
  try {
    const parsed = new URL(uri);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return uri.replace(/[?#].*$/, "");
  }
}

async function validateTorrentBuffer(
  buffer: Buffer
): Promise<ValidatedTorrent> {
  if (buffer.length === 0 || buffer.length > MAX_TORRENT_FILE_BYTES) {
    throw new Error("The torrent file is empty or unexpectedly large");
  }
  if (buffer[0] !== 0x64) {
    throw new Error("The selected file is not a valid torrent");
  }

  let parsed: ValidatedTorrent;
  try {
    parsed = (await parseTorrent(buffer)) as ValidatedTorrent;
  } catch {
    throw new Error("The selected file is not a valid torrent");
  }
  if (!parsed.infoHash) {
    throw new Error("The selected torrent has no info hash");
  }

  const lengths =
    parsed.files?.map((file) => file.length) ??
    (parsed.length == null ? [] : [parsed.length]);
  if (
    lengths.some(
      (length) =>
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > Number.MAX_SAFE_INTEGER
    )
  ) {
    throw new Error("The selected torrent contains an invalid file size");
  }

  const totalSize = lengths.reduce((total, length) => total + length, 0);
  if (!Number.isSafeInteger(totalSize)) {
    throw new Error("The selected torrent's total size is invalid");
  }

  return parsed;
}

async function downloadRemoteTorrentFile(uri: string) {
  let currentUrl = assertPublicRemoteUrlSyntax(uri);
  const { httpAgent, httpsAgent } = createPublicDownloadAgents();

  for (let redirectCount = 0; ; redirectCount += 1) {
    const safeUri = getLogSafeRemoteUrl(currentUrl.toString());
    logger.log(`[torrent-file] downloading .torrent from ${safeUri}`);
    const response = await axios.get<ArrayBuffer>(currentUrl.toString(), {
      responseType: "arraybuffer",
      timeout: 120_000,
      headers: { "User-Agent": "Mozilla/5.0" },
      maxRedirects: 0,
      maxContentLength: MAX_TORRENT_FILE_BYTES,
      maxBodyLength: MAX_TORRENT_FILE_BYTES,
      validateStatus: () => true,
      // Never delegate DNS resolution to an environment proxy: the guarded
      // lookup must vet the actual address used for every connection.
      proxy: false,
      httpAgent,
      httpsAgent,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) {
        throw new Error(`The torrent link returned HTTP ${response.status}`);
      }
      if (redirectCount >= MAX_TORRENT_REDIRECTS) {
        throw new Error("The torrent link redirected too many times");
      }
      currentUrl = assertPublicRemoteUrlSyntax(
        new URL(location, currentUrl).toString()
      );
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`The torrent link returned HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers["content-length"] ?? 0);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_TORRENT_FILE_BYTES
    ) {
      throw new Error("The remote torrent file is unexpectedly large");
    }

    const buffer = Buffer.from(response.data);
    await validateTorrentBuffer(buffer);
    return buffer;
  }
}

/**
 * Persist a user-selected torrent in GameHub's data directory. Download records
 * can then be resumed even when the original attachment is moved or deleted.
 */
export async function cacheLocalTorrentFile(sourcePath: string) {
  const resolvedSourcePath = path.resolve(sourcePath);
  if (path.extname(resolvedSourcePath).toLowerCase() !== ".torrent") {
    throw new Error("Please select a .torrent file");
  }

  const sourceStats = await fs.promises.stat(resolvedSourcePath);
  if (!sourceStats.isFile() || sourceStats.size <= 0) {
    throw new Error("The selected torrent file is empty or unavailable");
  }
  if (sourceStats.size > MAX_TORRENT_FILE_BYTES) {
    throw new Error("The selected torrent file is unexpectedly large");
  }

  const buffer = await fs.promises.readFile(resolvedSourcePath);
  // Parsing here rejects malformed bencode before it reaches TorBox.
  const parsed = await validateTorrentBuffer(buffer);

  const directory = torrentCacheDir();
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  const destinationPath = path.join(directory, `user-${digest}.torrent`);
  await fs.promises.mkdir(directory, { recursive: true });

  if (!fs.existsSync(destinationPath)) {
    const temporaryPath = `${destinationPath}.${process.pid}-${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx" });
    try {
      await fs.promises.rename(temporaryPath, destinationPath);
    } catch (error) {
      await fs.promises.unlink(temporaryPath).catch(() => undefined);
      if (!fs.existsSync(destinationPath)) throw error;
    }
  }

  return {
    path: destinationPath,
    name:
      typeof parsed.name === "string"
        ? parsed.name
        : (parsed.name?.[0] ?? path.basename(sourcePath, ".torrent")),
    infoHash: parsed.infoHash,
    totalSize:
      parsed.length ??
      parsed.files?.reduce((total, file) => total + file.length, 0) ??
      null,
  };
}

/**
 * Download (or reuse a cached copy of) a .torrent file. Cached by URL hash so
 * resumes and seeding restarts after an app restart don't re-fetch it.
 */
export async function ensureLocalTorrentFile(uri: string): Promise<string> {
  const dir = torrentCacheDir();
  const filename =
    crypto.createHash("sha1").update(uri).digest("hex") + ".torrent";
  const localPath = path.join(dir, filename);

  if (fs.existsSync(localPath)) {
    try {
      const stats = await fs.promises.lstat(localPath);
      if (
        stats.isFile() &&
        !stats.isSymbolicLink() &&
        stats.size > 0 &&
        stats.size <= MAX_TORRENT_FILE_BYTES
      ) {
        await validateTorrentBuffer(await fs.promises.readFile(localPath));
        return localPath;
      }
    } catch {
      // A partial/corrupt cache entry is safe to replace below.
    }
    await fs.promises.unlink(localPath).catch(() => undefined);
  }

  await fs.promises.mkdir(dir, { recursive: true });
  const buffer = await downloadRemoteTorrentFile(uri);

  const tempPath = `${localPath}.${process.pid}-${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(tempPath, buffer, { flag: "wx" });
  try {
    await fs.promises.rename(tempPath, localPath);
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => undefined);
    if (!fs.existsSync(localPath)) throw error;
  }
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
  const stats = await fs.promises.stat(localPath);
  if (
    !stats.isFile() ||
    stats.size <= 0 ||
    stats.size > MAX_TORRENT_FILE_BYTES
  ) {
    throw new Error("The torrent file is empty or unexpectedly large");
  }
  const buffer = await fs.promises.readFile(localPath);
  // A .torrent buffer always parses to a torrent-file instance (the magnet-uri
  // variant only comes from string inputs).
  const torrent = await validateTorrentBuffer(buffer);

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
