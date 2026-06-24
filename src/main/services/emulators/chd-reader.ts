import { promises as fs } from "node:fs";
import { inflateRawSync, inflateSync } from "node:zlib";

// CHD v5 reader — extracts leading data sectors for SKU scanning
// Reference: MAME CHD format specification

const CHD_MAGIC = "MComprHD";
const CHD_HEADER_SIZE_V5 = 124;
const CHD_V5 = 5;

const SCAN_LIMIT_BYTES = 16 * 1024 * 1024; // 16 MB
const MAX_HUNKS = 512;

// Compression type constants
const COMPRESSION_NONE = 0x6e6f6e65; // 'none'
const COMPRESSION_ZLIB = 0x7a6c6962; // 'zlib'

// Map code (first byte of compressed block) to decompressor
// V5 uses a lookup from map entry type byte:
// 0x00 = COMPRESSION_NONE (verbatim)
// 0x01 = COMPRESSION_ZLIB (deflate)
// 0x02 = ...
// Self-ref / parent-ref are skipped

interface ChdHeaderV5 {
  compressors: number[]; // 4 compressor IDs
  logicalBytes: bigint;
  mapOffset: bigint;
  metaOffset: bigint;
  hunkBytes: number;
  unitBytes: number;
  sha1: Buffer;
  rawSha1: Buffer;
  parentSha1: Buffer;
}

const parseChdHeaderV5 = (buf: Buffer): ChdHeaderV5 | null => {
  if (buf.length < CHD_HEADER_SIZE_V5) return null;
  const magic = buf.subarray(0, 8).toString("ascii");
  if (magic !== CHD_MAGIC) return null;
  // Length at offset 8 (uint32_be)
  const headerLen = buf.readUInt32BE(8);
  if (headerLen !== CHD_HEADER_SIZE_V5) return null;
  const version = buf.readUInt32BE(12);
  if (version !== CHD_V5) return null;

  const compressors = [
    buf.readUInt32BE(16),
    buf.readUInt32BE(20),
    buf.readUInt32BE(24),
    buf.readUInt32BE(28),
  ];

  const logicalBytes = buf.readBigUInt64BE(32);
  const mapOffset = buf.readBigUInt64BE(40);
  const metaOffset = buf.readBigUInt64BE(48);
  const hunkBytes = buf.readUInt32BE(56);
  const unitBytes = buf.readUInt32BE(60);
  const sha1 = buf.subarray(64, 84);
  const rawSha1 = buf.subarray(84, 104);
  const parentSha1 = buf.subarray(104, 124);

  return {
    compressors,
    logicalBytes,
    mapOffset,
    metaOffset,
    hunkBytes,
    unitBytes,
    sha1,
    rawSha1,
    parentSha1,
  };
};

// V5 map entry is 12 bytes per hunk
// Bytes 0-2: compressed length (big-endian, 3 bytes) — 0 = self/parent ref
// Byte 3: compression type
// Bytes 4-11: file offset (big-endian, 8 bytes)
const MAP_ENTRY_SIZE = 12;

const decompressHunk = (
  compType: number,
  hdr: ChdHeaderV5,
  compressed: Buffer
): Buffer | null => {
  const isNone =
    compType === 0 || // verbatim
    hdr.compressors[0] === COMPRESSION_NONE;

  if (isNone || compType === 0x00) {
    return compressed; // already raw
  }

  const codec = hdr.compressors[compType - 1] ?? hdr.compressors[0];

  if (codec === COMPRESSION_NONE) return compressed;

  if (codec === COMPRESSION_ZLIB) {
    try {
      return inflateRawSync(compressed);
    } catch {
      try {
        return inflateSync(compressed);
      } catch {
        return null;
      }
    }
  }

  // For other codecs (LZMA, FLAC) we skip — too complex without native libs
  return null;
};

export const readChdLeadingData = async (
  filePath: string
): Promise<{ chunks: Buffer[] } | null> => {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(filePath, "r");

    // Read header
    const hdrBuf = Buffer.alloc(CHD_HEADER_SIZE_V5);
    const { bytesRead: hdrRead } = await fh.read(
      hdrBuf,
      0,
      CHD_HEADER_SIZE_V5,
      0
    );
    if (hdrRead < CHD_HEADER_SIZE_V5) return null;

    const hdr = parseChdHeaderV5(hdrBuf);
    if (!hdr) return null;
    if (hdr.hunkBytes === 0) return null;

    const mapOff = Number(hdr.mapOffset);
    if (mapOff <= 0) return null;

    const chunks: Buffer[] = [];
    let bytesCollected = 0;
    const maxHunks = Math.min(
      MAX_HUNKS,
      Math.ceil(SCAN_LIMIT_BYTES / hdr.hunkBytes)
    );

    for (let hunkIdx = 0; hunkIdx < maxHunks; hunkIdx++) {
      const mapEntryOff = mapOff + hunkIdx * MAP_ENTRY_SIZE;
      const mapBuf = Buffer.alloc(MAP_ENTRY_SIZE);
      const { bytesRead: mapRead } = await fh.read(
        mapBuf,
        0,
        MAP_ENTRY_SIZE,
        mapEntryOff
      );
      if (mapRead < MAP_ENTRY_SIZE) break;

      // Compressed length: 3 bytes big-endian at offset 0
      const compLen =
        (mapBuf[0] << 16) | (mapBuf[1] << 8) | mapBuf[2];
      const compType = mapBuf[3];

      // File offset: 8 bytes big-endian at offset 4
      const fileOffHi = mapBuf.readUInt32BE(4);
      const fileOffLo = mapBuf.readUInt32BE(8);
      const fileOff = fileOffHi * 0x100000000 + fileOffLo;

      // type 0x80 = self-ref, 0x81 = parent-ref — skip
      if (compType >= 0x80) {
        // Push an empty hunk placeholder so scanning can continue
        chunks.push(Buffer.alloc(hdr.hunkBytes));
        bytesCollected += hdr.hunkBytes;
        continue;
      }

      // If compLen === hunkBytes, the data is verbatim (uncompressed)
      const readLen = compLen === 0 ? hdr.hunkBytes : compLen;
      if (readLen === 0) break;

      const rawBuf = Buffer.alloc(readLen);
      const { bytesRead: dataRead } = await fh.read(
        rawBuf,
        0,
        readLen,
        fileOff
      );
      if (dataRead < readLen) break;

      let hunkData: Buffer | null;
      if (compLen === hdr.hunkBytes || compType === 0) {
        hunkData = rawBuf; // uncompressed
      } else {
        hunkData = decompressHunk(compType, hdr, rawBuf);
      }

      if (!hunkData) {
        chunks.push(Buffer.alloc(hdr.hunkBytes));
      } else {
        chunks.push(hunkData);
      }

      bytesCollected += hdr.hunkBytes;
      if (bytesCollected >= SCAN_LIMIT_BYTES) break;
    }

    return chunks.length > 0 ? { chunks } : null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};

