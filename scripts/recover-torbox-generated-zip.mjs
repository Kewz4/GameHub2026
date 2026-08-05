import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ClassicLevel } from "classic-level";

const TORBOX_API = "https://api.torbox.app/v1/api";
const CHUNK_BYTES = 16 * 1024 * 1024;
// TorBox/CDN endpoints can throttle or reset large HTTP/2 fan-outs. Four
// bounded ranges keeps the transfer fast without making one throttled stream
// discard an entire 128 MiB batch.
const PARALLEL_CONNECTIONS = 4;
const SEGMENT_BYTES = 8 * 1024 * 1024;
const SYNC_INTERVAL_BYTES = 256 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const VERIFY_HEAD_BYTES = 64 * 1024;
const VERIFY_TAIL_BYTES = 1024 * 1024;
const MAX_TRANSFER_RETRIES = 20;

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export function updateCrc32(state, buffer) {
  let next = state >>> 0;
  for (let index = 0; index < buffer.length; index += 1) {
    next = crcTable[(next ^ buffer[index]) & 0xff] ^ (next >>> 8);
  }
  return next >>> 0;
}

export function finishCrc32(state) {
  return (state ^ 0xffffffff) >>> 0;
}

export function parseStoredZip64LocalHeader(buffer) {
  if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("The partial does not begin with a ZIP local-file header");
  }

  const versionNeeded = buffer.readUInt16LE(4);
  const flags = buffer.readUInt16LE(6);
  const method = buffer.readUInt16LE(8);
  const modTime = buffer.readUInt16LE(10);
  const modDate = buffer.readUInt16LE(12);
  const compressed32 = buffer.readUInt32LE(18);
  const uncompressed32 = buffer.readUInt32LE(22);
  const filenameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);
  const headerLength = 30 + filenameLength + extraLength;

  if (buffer.length < headerLength) {
    throw new Error("The ZIP local-file header is truncated");
  }
  if (method !== 0) {
    throw new Error(
      `The legacy ZIP uses compression method ${method}; only STORE can be recovered safely`
    );
  }
  if ((flags & 0x0008) === 0) {
    throw new Error("The legacy ZIP does not use a streaming data descriptor");
  }
  if (compressed32 !== 0xffffffff || uncompressed32 !== 0xffffffff) {
    throw new Error("The legacy ZIP is not the expected ZIP64 stream");
  }

  const filename = Buffer.from(buffer.subarray(30, 30 + filenameLength));
  return {
    versionNeeded,
    flags,
    method,
    modTime,
    modDate,
    filename,
    filenameText: filename.toString("utf8"),
    headerLength,
  };
}

function writeUInt64LE(buffer, value, offset) {
  buffer.writeBigUInt64LE(BigInt(value), offset);
}

export function buildStoredZip64Trailer({
  header,
  rawSize,
  crc32,
  expectedTotalSize,
}) {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc32 >>> 0, 4);
  writeUInt64LE(descriptor, rawSize, 8);
  writeUInt64LE(descriptor, rawSize, 16);

  const zip64Extra = Buffer.alloc(28);
  zip64Extra.writeUInt16LE(0x0001, 0);
  zip64Extra.writeUInt16LE(24, 2);
  writeUInt64LE(zip64Extra, rawSize, 4);
  writeUInt64LE(zip64Extra, rawSize, 12);
  writeUInt64LE(zip64Extra, 0, 20);

  const central = Buffer.alloc(46 + header.filename.length + zip64Extra.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x032d, 4);
  central.writeUInt16LE(header.versionNeeded, 6);
  central.writeUInt16LE(header.flags, 8);
  central.writeUInt16LE(header.method, 10);
  central.writeUInt16LE(header.modTime, 12);
  central.writeUInt16LE(header.modDate, 14);
  central.writeUInt32LE(crc32 >>> 0, 16);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(header.filename.length, 28);
  central.writeUInt16LE(zip64Extra.length, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0xffffffff, 42);
  header.filename.copy(central, 46);
  zip64Extra.copy(central, 46 + header.filename.length);

  const centralOffset = header.headerLength + rawSize + descriptor.length;
  const zip64EocdOffset = centralOffset + central.length;
  const zip64Eocd = Buffer.alloc(56);
  zip64Eocd.writeUInt32LE(0x06064b50, 0);
  writeUInt64LE(zip64Eocd, 44, 4);
  zip64Eocd.writeUInt16LE(0x032d, 12);
  zip64Eocd.writeUInt16LE(header.versionNeeded, 14);
  zip64Eocd.writeUInt32LE(0, 16);
  zip64Eocd.writeUInt32LE(0, 20);
  writeUInt64LE(zip64Eocd, 1, 24);
  writeUInt64LE(zip64Eocd, 1, 32);
  writeUInt64LE(zip64Eocd, central.length, 40);
  writeUInt64LE(zip64Eocd, centralOffset, 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  writeUInt64LE(locator, zip64EocdOffset, 8);
  locator.writeUInt32LE(1, 16);

  const eocdBase = Buffer.alloc(22);
  eocdBase.writeUInt32LE(0x06054b50, 0);
  eocdBase.writeUInt16LE(0, 4);
  eocdBase.writeUInt16LE(0, 6);
  eocdBase.writeUInt16LE(0xffff, 8);
  eocdBase.writeUInt16LE(0xffff, 10);
  eocdBase.writeUInt32LE(0xffffffff, 12);
  eocdBase.writeUInt32LE(0xffffffff, 16);

  const withoutComment =
    header.headerLength +
    rawSize +
    descriptor.length +
    central.length +
    zip64Eocd.length +
    locator.length +
    eocdBase.length;
  const commentLength = expectedTotalSize - withoutComment;
  if (!Number.isSafeInteger(commentLength) || commentLength < 0 || commentLength > 0xffff) {
    throw new Error(
      `Cannot preserve the generated ZIP size: calculated comment length is ${commentLength}`
    );
  }
  eocdBase.writeUInt16LE(commentLength, 20);
  const comment = Buffer.alloc(commentLength, 0x20);
  const label = Buffer.from("Recovered safely by GameHub 1.1.39");
  label.copy(comment, 0, 0, Math.min(label.length, comment.length));

  const trailer = Buffer.concat([
    descriptor,
    central,
    zip64Eocd,
    locator,
    eocdBase,
    comment,
  ]);
  assert.equal(header.headerLength + rawSize + trailer.length, expectedTotalSize);
  return trailer;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(3)} GiB`;
}

function normalizeName(value) {
  return (value.replaceAll("\\", "/").split("/").at(-1) ?? "").toLowerCase();
}

function parseArgs(argv) {
  const result = { mode: "verify" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--recover") result.mode = "recover";
    else if (arg === "--verify") result.mode = "verify";
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replaceAll("-", "_");
      result[key] = argv[++index];
    }
  }
  return result;
}

async function readTorBoxToken(dataDir) {
  const source = path.join(dataDir, "gamehub-db");
  if (!fs.existsSync(source)) throw new Error(`GameHub database not found: ${source}`);

  const tempRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "gamehub-recovery-db-")
  );
  const copy = path.join(tempRoot, "db");
  try {
    await fs.promises.cp(source, copy, {
      recursive: true,
      filter: (entry) => path.basename(entry).toUpperCase() !== "LOCK",
    });
    const db = new ClassicLevel(copy, { valueEncoding: "json" });
    try {
      await db.open();
      const preferences = await db.get("userPreferences");
      const token = preferences?.torBoxApiToken?.trim();
      if (!token) throw new Error("No TorBox API token is configured in GameHub");
      return token;
    } finally {
      await db.close().catch(() => undefined);
    }
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function torBoxJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    const error = new Error(`TorBox API request failed (HTTP ${response.status})`);
    error.status = response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    const resetAt = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      error.retryAfterMs = retryAfter * 1_000;
    } else if (Number.isFinite(resetAt) && resetAt > 0) {
      error.retryAfterMs = Math.max(0, resetAt * 1_000 - Date.now());
    }
    throw error;
  }
  return payload.data;
}

async function findWebDownload(token, sourceUrl, requestedId) {
  const url = new URL(`${TORBOX_API}/webdl/mylist`);
  url.searchParams.set("bypass_cache", "true");
  const items = await torBoxJson(url, token);
  if (!Array.isArray(items)) throw new Error("TorBox returned an invalid web list");
  const expectedHash = crypto.createHash("md5").update(sourceUrl).digest("hex");
  const item = requestedId
    ? items.find((entry) => entry.id === Number(requestedId))
    : items.find((entry) => entry.original_url === sourceUrl) ??
      items.find((entry) => entry.hash?.toLowerCase() === expectedHash);
  if (!item) throw new Error("The matching TorBox web download was not found");
  return item;
}

async function requestDownloadLink(token, webId, fileId) {
  const url = new URL(`${TORBOX_API}/webdl/requestdl`);
  url.searchParams.set("token", token);
  url.searchParams.set("web_id", String(webId));
  if (fileId == null) url.searchParams.set("zip_link", "true");
  else url.searchParams.set("file_id", String(fileId));
  for (let attempt = 1; attempt <= MAX_TRANSFER_RETRIES; attempt += 1) {
    try {
      const link = await torBoxJson(url, token);
      if (typeof link !== "string" || !/^https:\/\//i.test(link)) {
        throw new Error("TorBox returned an invalid download link");
      }
      return link;
    } catch (error) {
      if (error?.status !== 429 || attempt === MAX_TRANSFER_RETRIES) throw error;
      const delay = Math.max(60_000, Number(error.retryAfterMs) || 0);
      console.log(
        `[recovery] TorBox API cooldown; retrying the signed-link request in ${Math.ceil(delay / 1000)}s (${attempt}/${MAX_TRANSFER_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("TorBox did not provide a download link after its cooldown");
}

function parseContentRange(response) {
  const match = /bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(
    response.headers.get("content-range") ?? ""
  );
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  };
}

async function getGeneratedZipSize(token, webId) {
  const link = await requestDownloadLink(token, webId, null);
  const response = await fetch(link, {
    headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
  });
  try {
    const range = parseContentRange(response);
    const size = range?.total ?? Number(response.headers.get("content-length"));
    if (!response.ok || !Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`Could not determine generated ZIP size (HTTP ${response.status})`);
    }
    return size;
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

async function fetchExactRange(getLink, start, end, totalSize) {
  const response = await fetch(await getLink(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Range: `bytes=${start}-${end}`,
      "Accept-Encoding": "identity",
    },
  });
  try {
    const range = parseContentRange(response);
    const encoding = (response.headers.get("content-encoding") ?? "").toLowerCase();
    if (
      response.status !== 206 ||
      !range ||
      range.start !== start ||
      range.end !== end ||
      range.total !== totalSize ||
      (encoding && encoding !== "identity")
    ) {
      const actualRange = range
        ? `${range.start}-${range.end}/${range.total}`
        : "missing";
      throw new Error(
        `TorBox raw range mismatch (HTTP ${response.status}, requested ${start}-${end}/${totalSize}, received ${actualRange}, encoding ${encoding || "identity"})`
      );
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length !== end - start + 1) {
      throw new Error("TorBox returned an incomplete verification range");
    }
    return data;
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

async function readLocalRange(fileHandle, start, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
  if (bytesRead !== length) throw new Error("The local partial changed during verification");
  return buffer;
}

async function verifyPayloadIdentity({
  partialPath,
  header,
  rawSize,
  getRawLink,
}) {
  const stats = await fs.promises.stat(partialPath);
  const payloadBytes = stats.size - header.headerLength;
  if (payloadBytes <= 0 || payloadBytes > rawSize) {
    throw new Error(
      `Unexpected partial payload length ${payloadBytes}; expected 1..${rawSize}`
    );
  }

  const handle = await fs.promises.open(partialPath, "r");
  try {
    const headLength = Math.min(VERIFY_HEAD_BYTES, payloadBytes);
    const localHead = await readLocalRange(handle, header.headerLength, headLength);
    const remoteHead = await fetchExactRange(getRawLink, 0, headLength - 1, rawSize);
    if (!localHead.equals(remoteHead)) {
      throw new Error("The beginning of the ZIP payload does not match TorBox's raw file");
    }

    const tailLength = Math.min(VERIFY_TAIL_BYTES, payloadBytes);
    const tailStart = payloadBytes - tailLength;
    const localTail = await readLocalRange(
      handle,
      header.headerLength + tailStart,
      tailLength
    );
    const remoteTail = await fetchExactRange(
      getRawLink,
      tailStart,
      payloadBytes - 1,
      rawSize
    );
    if (!localTail.equals(remoteTail)) {
      throw new Error("The ZIP payload does not match TorBox at the resume boundary");
    }
  } finally {
    await handle.close();
  }
  return payloadBytes;
}

async function scanExistingPayload(partialPath, headerLength, payloadBytes) {
  const handle = await fs.promises.open(partialPath, "r");
  const md5 = crypto.createHash("md5");
  let crcState = 0xffffffff;
  let position = 0;
  let lastReport = 0;
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    while (position < payloadBytes) {
      const length = Math.min(buffer.length, payloadBytes - position);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        headerLength + position
      );
      if (bytesRead !== length) throw new Error("The local partial changed during CRC scan");
      const chunk = buffer.subarray(0, bytesRead);
      crcState = updateCrc32(crcState, chunk);
      md5.update(chunk);
      position += bytesRead;

      const now = Date.now();
      if (now - lastReport >= 5000 || position === payloadBytes) {
        console.log(
          `[recovery] local integrity scan ${((position / payloadBytes) * 100).toFixed(1)}%`
        );
        lastReport = now;
      }
    }
  } finally {
    await handle.close();
  }
  return { crcState, md5 };
}

async function writeAll(handle, buffer, position) {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(
      buffer,
      written,
      buffer.length - written,
      position + written
    );
    if (result.bytesWritten <= 0) throw new Error("The recovery write made no progress");
    written += result.bytesWritten;
  }
}

async function appendMissingRawBytes({
  partialPath,
  headerLength,
  rawSize,
  initialPayloadBytes,
  getRawLink,
  journalPath,
}) {
  const handle = await fs.promises.open(partialPath, "r+");
  let rawOffset = initialPayloadBytes;
  let bytesSinceSync = 0;
  let retry = 0;
  let cachedLink = null;

  try {
    while (rawOffset < rawSize) {
      try {
        cachedLink ??= await getRawLink();
        const link = cachedLink;
        const segments = [];
        let segmentStart = rawOffset;
        while (
          segmentStart < rawSize &&
          segments.length < PARALLEL_CONNECTIONS
        ) {
          const segmentEnd = Math.min(
            rawSize - 1,
            segmentStart + SEGMENT_BYTES - 1
          );
          segments.push({ start: segmentStart, end: segmentEnd });
          segmentStart = segmentEnd + 1;
        }

        const results = await Promise.allSettled(
          segments.map((segment) =>
            fetchExactRange(
              async () => link,
              segment.start,
              segment.end,
              rawSize
            )
          )
        );
        let contiguousResults = 0;
        while (results[contiguousResults]?.status === "fulfilled") {
          contiguousResults += 1;
        }
        if (contiguousResults === 0) {
          const first = results[0];
          throw first?.status === "rejected"
            ? first.reason
            : new Error("No TorBox range completed");
        }

        const stats = await handle.stat();
        if (stats.size !== headerLength + rawOffset) {
          throw new Error(
            "The partial was modified by another process during recovery"
          );
        }

        for (const result of results.slice(0, contiguousResults)) {
          if (result.status !== "fulfilled") {
            throw new Error("A parallel TorBox range did not complete");
          }
          const chunk = result.value;
          await writeAll(handle, chunk, headerLength + rawOffset);
          rawOffset += chunk.length;
          bytesSinceSync += chunk.length;
        }

        retry = 0;
        if (bytesSinceSync >= SYNC_INTERVAL_BYTES || rawOffset === rawSize) {
          await handle.sync();
          bytesSinceSync = 0;
          await fs.promises.writeFile(
            journalPath,
            JSON.stringify({ state: "downloading", rawOffset, rawSize }, null, 2)
          );
        }
        console.log(
          `[recovery] network ${(100 * rawOffset / rawSize).toFixed(2)}% total; ${formatBytes(rawSize - rawOffset)} remains (${contiguousResults}/${segments.length} parallel ranges kept)`
        );
        const failed = results[contiguousResults];
        if (failed?.status === "rejected") throw failed.reason;
      } catch (error) {
        cachedLink = null;
        retry += 1;
        if (retry > MAX_TRANSFER_RETRIES) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        const delay = reason.includes("HTTP 429")
          ? 60_000
          : Math.min(1000 * 2 ** (retry - 1), 15_000);
        console.log(
          `[recovery] connection interrupted (${reason}); refreshing the TorBox link and resuming in ${delay / 1000}s (${retry}/${MAX_TRANSFER_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function runRecovery(options) {
  if (!options.partial || !options.data_dir || !options.source) {
    throw new Error(
      "Usage: node scripts/recover-torbox-generated-zip.mjs --verify|--recover --partial <file> --data-dir <GameHub data> --source <original URL> [--web-id <id>]"
    );
  }

  const partialPath = path.resolve(options.partial);
  const dataDir = path.resolve(options.data_dir);
  const initialStats = await fs.promises.stat(partialPath);
  const firstHeaderBytes = Buffer.alloc(4096);
  const partialHandle = await fs.promises.open(partialPath, "r");
  try {
    const { bytesRead } = await partialHandle.read(firstHeaderBytes, 0, firstHeaderBytes.length, 0);
    if (bytesRead < 30) throw new Error("The partial is too short to be a ZIP");
  } finally {
    await partialHandle.close();
  }
  const header = parseStoredZip64LocalHeader(firstHeaderBytes);

  const token = await readTorBoxToken(dataDir);
  const web = await findWebDownload(token, options.source, options.web_id);
  const files = Array.isArray(web.files) ? web.files : [];
  const target = files.find(
    (file) =>
      normalizeName(file.name) === normalizeName(header.filenameText) ||
      normalizeName(file.short_name ?? "") === normalizeName(header.filenameText)
  );
  if (!target || !Number.isSafeInteger(target.size) || target.size <= 0) {
    throw new Error("The ZIP payload could not be matched to one TorBox raw file");
  }

  const rawSize = target.size;
  const getRawLink = () => requestDownloadLink(token, web.id, target.id);
  const suppliedZipSize = Number(options.expected_zip_size);
  const expectedZipSize = Number.isSafeInteger(suppliedZipSize) && suppliedZipSize > rawSize
    ? suppliedZipSize
    : await getGeneratedZipSize(token, web.id);

  if (
    initialStats.size === expectedZipSize &&
    initialStats.size > header.headerLength + rawSize
  ) {
    console.log("[recovery] the generated ZIP is already complete");
    return;
  }

  const verificationLink = await getRawLink();
  const payloadBytes = await verifyPayloadIdentity({
    partialPath,
    header,
    rawSize,
    getRawLink: async () => verificationLink,
  });
  const remainingRaw = rawSize - payloadBytes;
  console.log(
    `[recovery] verified ${formatBytes(payloadBytes)} already present; ${formatBytes(remainingRaw)} raw data remains`
  );
  console.log(
    `[recovery] ZIP header=${header.headerLength} bytes, raw=${rawSize}, generated ZIP=${expectedZipSize}`
  );

  if (options.mode !== "recover") {
    const finalStats = await fs.promises.stat(partialPath);
    if (finalStats.size !== initialStats.size) {
      throw new Error("The partial changed during read-only verification");
    }
    console.log("[recovery] verification passed; no file bytes were changed");
    return;
  }

  const journalPath = `${partialPath}.gamehub-recovery.json`;
  await fs.promises.writeFile(
    journalPath,
    JSON.stringify(
      {
        state: "verified",
        originalSize: initialStats.size,
        headerLength: header.headerLength,
        rawSize,
        expectedZipSize,
      },
      null,
      2
    )
  );

  console.log("[recovery] appending only the missing raw ranges");
  await appendMissingRawBytes({
    partialPath,
    headerLength: header.headerLength,
    rawSize,
    initialPayloadBytes: payloadBytes,
    getRawLink,
    journalPath,
  });

  console.log("[recovery] computing final CRC32 and MD5 over the complete payload");
  const { crcState, md5 } = await scanExistingPayload(
    partialPath,
    header.headerLength,
    rawSize
  );

  const actualMd5 = md5.digest("hex");
  if (/^[a-f0-9]{32}$/i.test(target.md5 ?? "") && actualMd5 !== target.md5.toLowerCase()) {
    throw new Error(
      "The completed raw payload failed TorBox's MD5 integrity check; refusing to finalize the ZIP"
    );
  }

  const crc32 = finishCrc32(crcState);
  const trailer = buildStoredZip64Trailer({
    header,
    rawSize,
    crc32,
    expectedTotalSize: expectedZipSize,
  });
  const finalHandle = await fs.promises.open(partialPath, "r+");
  try {
    const stats = await finalHandle.stat();
    if (stats.size !== header.headerLength + rawSize) {
      throw new Error("The raw payload length changed before ZIP finalization");
    }
    await writeAll(finalHandle, trailer, stats.size);
    await finalHandle.sync();
  } finally {
    await finalHandle.close();
  }

  const finalStats = await fs.promises.stat(partialPath);
  if (finalStats.size !== expectedZipSize) {
    throw new Error(
      `Recovered ZIP has unexpected size ${finalStats.size}; expected ${expectedZipSize}`
    );
  }
  await fs.promises.rm(journalPath, { force: true });
  console.log(
    `[recovery] complete: preserved ${formatBytes(payloadBytes)} and downloaded only ${formatBytes(remainingRaw)}`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runRecovery(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`[recovery] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
