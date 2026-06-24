import { promises as fs } from "node:fs";

// PS1 memory card format (.mcd / .mcr) — standard 128 KB image
// 16 blocks × 8192 bytes; block 0 = directory

const BLOCK_SIZE = 8192;
const FRAME_SIZE = 128;

// Block 0 frame layout (128 bytes each):
// Offset 0: uint32_le state
// Offset 4: uint32_le fileSize
// Offset 8: uint16_le nextBlock (0xFFFF = none)
// Offset 10: char[20] filename (null-terminated)
// Offset 127: uint8 checksum (XOR of bytes 0-126)

const STATE_FIRST = 0x51;
const STATE_MIDDLE = 0x52;
const STATE_LAST = 0x53;

export interface Ps1SaveEntry {
  identifier: string; // game product code, e.g. "BASLUS-00501"
  fileSize: number;
  blockCount: number;
  blockIndices: number[]; // 1-based block indices
  createdAt: number; // 0 — PS1 cards don't store timestamps
  modifiedAt: number;
}

export const scanPs1MemoryCard = async (
  cardFilePath: string
): Promise<Ps1SaveEntry[]> => {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(cardFilePath, "r");

    // Read block 0 (directory)
    const block0 = Buffer.alloc(BLOCK_SIZE);
    const { bytesRead } = await fh.read(block0, 0, BLOCK_SIZE, 0);
    if (bytesRead < BLOCK_SIZE) return [];

    // Verify magic "MC" at frame 0
    if (block0[0] !== 0x4d || block0[1] !== 0x43) return [];

    const entries: Ps1SaveEntry[] = [];

    // Frames 1-15 = directory entries for blocks 1-15
    for (let frame = 1; frame <= 15; frame++) {
      const off = frame * FRAME_SIZE;
      const state = block0.readUInt32LE(off);
      if (state !== STATE_FIRST) continue;

      const fileSize = block0.readUInt32LE(off + 4);
      const rawName = block0
        .subarray(off + 10, off + 30)
        .toString("ascii")
        .replace(/\0.*/, "")
        .trim();

      if (!rawName) continue;

      // Follow block chain to count blocks
      const blockIndices: number[] = [frame];
      let cur = frame;
      let limit = 0;

      while (limit++ < 15) {
        const nextRaw = block0.readUInt16LE(cur * FRAME_SIZE + 8);
        if (nextRaw === 0xffff || nextRaw === 0 || nextRaw > 15) break;
        const nextState = block0.readUInt32LE(nextRaw * FRAME_SIZE);
        if (nextState !== STATE_MIDDLE && nextState !== STATE_LAST) break;
        blockIndices.push(nextRaw);
        cur = nextRaw;
        if (nextState === STATE_LAST) break;
      }

      entries.push({
        identifier: rawName,
        fileSize,
        blockCount: blockIndices.length,
        blockIndices,
        createdAt: 0,
        modifiedAt: 0,
      });
    }

    return entries;
  } catch {
    return [];
  } finally {
    await fh?.close();
  }
};

export interface Ps1SaveContents {
  identifier: string;
  dirFrame: Buffer; // 128-byte directory frame
  blocks: Buffer[]; // each 8192-byte data block
}

export const readPs1SaveContents = async (
  cardFilePath: string,
  identifier: string
): Promise<Ps1SaveContents | null> => {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(cardFilePath, "r");

    const block0 = Buffer.alloc(BLOCK_SIZE);
    const { bytesRead } = await fh.read(block0, 0, BLOCK_SIZE, 0);
    if (bytesRead < BLOCK_SIZE) return null;

    if (block0[0] !== 0x4d || block0[1] !== 0x43) return null;

    // Find the save with matching identifier
    let startFrame = -1;
    for (let frame = 1; frame <= 15; frame++) {
      const off = frame * FRAME_SIZE;
      if (block0.readUInt32LE(off) !== STATE_FIRST) continue;
      const rawName = block0
        .subarray(off + 10, off + 30)
        .toString("ascii")
        .replace(/\0.*/, "")
        .trim();
      if (rawName === identifier) {
        startFrame = frame;
        break;
      }
    }

    if (startFrame === -1) return null;

    const dirFrame = block0.subarray(
      startFrame * FRAME_SIZE,
      startFrame * FRAME_SIZE + FRAME_SIZE
    );

    // Follow chain to collect all block indices
    const blockIndices: number[] = [startFrame];
    let cur = startFrame;

    for (let limit = 0; limit < 15; limit++) {
      const nextRaw = block0.readUInt16LE(cur * FRAME_SIZE + 8);
      if (nextRaw === 0xffff || nextRaw === 0 || nextRaw > 15) break;
      const nextState = block0.readUInt32LE(nextRaw * FRAME_SIZE);
      if (nextState !== STATE_MIDDLE && nextState !== STATE_LAST) break;
      blockIndices.push(nextRaw);
      cur = nextRaw;
      if (nextState === STATE_LAST) break;
    }

    const blocks: Buffer[] = [];
    for (const idx of blockIndices) {
      const blockBuf = Buffer.alloc(BLOCK_SIZE);
      const { bytesRead: br } = await fh.read(
        blockBuf,
        0,
        BLOCK_SIZE,
        idx * BLOCK_SIZE
      );
      blocks.push(blockBuf.subarray(0, br));
    }

    return {
      identifier,
      dirFrame: Buffer.from(dirFrame),
      blocks,
    };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};

// Build .mcs export: 128-byte dir frame + data blocks
export const buildMcsBuffer = (contents: Ps1SaveContents): Buffer => {
  const parts: Buffer[] = [Buffer.from(contents.dirFrame)];
  for (const block of contents.blocks) {
    const padded = Buffer.alloc(BLOCK_SIZE);
    block.copy(padded);
    parts.push(padded);
  }
  return Buffer.concat(parts);
};

