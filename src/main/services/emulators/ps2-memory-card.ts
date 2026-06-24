import { promises as fs } from "node:fs";

// PCSX2 .ps2 memory card — PS2 MCF (Memory Card File System) format
// Standard 8 MB card: 16384 pages × 512 bytes, 2 pages/cluster, alloc at cluster 33

const PAGE_SIZE = 512;
const CLUSTER_SIZE = PAGE_SIZE * 2; // 1024
const SUPERBLOCK_MAGIC = "Sony PS2 Memory Card Format ";

// MCF mode flags
const MC_ATTR_EXISTS = 0x8000;
const MC_ATTR_SUBDIR = 0x0020;
const MC_ATTR_FILE = 0x0010;

// Directory entry layout (one per PAGE = 512 bytes; metadata in first 64 bytes)
const ENTRY_STRIDE = PAGE_SIZE;
const MODE_OFF = 0;
const LENGTH_OFF = 4;
const CLUSTER_OFF = 16;
const NAME_OFF = 36;
const NAME_LEN = 28;

interface McSuperBlock {
  allocOffset: number; // in clusters
  ifcList: number[]; // absolute cluster numbers of FAT pages
}

const parseSuperBlock = (buf: Buffer): McSuperBlock | null => {
  if (buf.length < PAGE_SIZE) return null;
  const magic = buf.subarray(0, 28).toString("latin1");
  if (magic !== SUPERBLOCK_MAGIC) return null;
  const allocOffset = buf.readUInt32LE(0x30) || 33;
  const ifcList: number[] = [];
  for (let i = 0; i < 32; i++) {
    const v = buf.readUInt32LE(0x80 + i * 4);
    if (v === 0xffffffff) break;
    ifcList.push(v);
  }
  return { allocOffset, ifcList };
};

const parseBcd = (b: number) => Math.floor(b / 16) * 10 + (b % 16);

const bcdToMs = (buf: Buffer, off: number): number => {
  const sec = parseBcd(buf[off]);
  const min = parseBcd(buf[off + 1]);
  const hr = parseBcd(buf[off + 2]);
  const day = parseBcd(buf[off + 3]);
  const mon = parseBcd(buf[off + 4]);
  const yr = parseBcd(buf[off + 5]) + parseBcd(buf[off + 6]) * 100;
  try {
    return new Date(yr, mon - 1, day, hr, min, sec).getTime();
  } catch {
    return 0;
  }
};

interface McFsEntry {
  mode: number;
  length: number; // #entries for dirs, bytes for files
  cluster: number; // relative to allocOffset
  name: string;
  createdAt: number;
  modifiedAt: number;
}

const parseEntry = (buf: Buffer, off: number): McFsEntry | null => {
  if (off + 64 > buf.length) return null;
  const mode = buf.readUInt16LE(off + MODE_OFF);
  if (!(mode & MC_ATTR_EXISTS)) return null;
  const length = buf.readUInt32LE(off + LENGTH_OFF);
  const cluster = buf.readUInt32LE(off + CLUSTER_OFF);
  const createdAt = bcdToMs(buf, off + 8);
  const modifiedAt = bcdToMs(buf, off + 24);
  const nameBuf = buf.subarray(off + NAME_OFF, off + NAME_OFF + NAME_LEN);
  const nul = nameBuf.indexOf(0);
  const name = nameBuf
    .subarray(0, nul === -1 ? NAME_LEN : nul)
    .toString("ascii")
    .trim();
  return { mode, length, cluster, name, createdAt, modifiedAt };
};

// Read the FAT chain for a relative cluster (relative to allocOffset)
const readFatChain = async (
  fh: Awaited<ReturnType<typeof fs.open>>,
  sb: McSuperBlock,
  startCluster: number
): Promise<number[]> => {
  const chain: number[] = [];
  const seen = new Set<number>();
  let cur = startCluster;

  while (cur !== 0x7fffffff && !seen.has(cur) && chain.length < 4096) {
    seen.add(cur);
    chain.push(cur);

    // FAT entry for cluster `cur`:
    // IFC index = Math.floor(cur / 256)
    // Entry within FAT cluster = cur % 256
    const ifcIdx = Math.floor(cur / 256);
    const fatCluster = sb.ifcList[ifcIdx];
    if (fatCluster === undefined || fatCluster === 0xffffffff) break;

    const entryOff = cur % 256;
    const fatByteOff = fatCluster * CLUSTER_SIZE + entryOff * 4;
    const fatBuf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(fatBuf, 0, 4, fatByteOff);
    if (bytesRead < 4) break;
    const next = fatBuf.readUInt32LE(0) & 0x7fffffff;
    cur = next;
  }
  return chain;
};

const readClusters = async (
  fh: Awaited<ReturnType<typeof fs.open>>,
  sb: McSuperBlock,
  clusters: number[]
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for (const rel of clusters) {
    const off = (sb.allocOffset + rel) * CLUSTER_SIZE;
    const buf = Buffer.alloc(CLUSTER_SIZE);
    const { bytesRead } = await fh.read(buf, 0, CLUSTER_SIZE, off);
    chunks.push(buf.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks);
};

export interface Ps2SaveFile {
  entry: Buffer; // raw 512-byte entry page
  data: Buffer; // raw file data (may be padded to cluster boundary)
}

export interface Ps2SaveContents {
  dirEntry: Buffer; // 512-byte directory entry page for the save folder
  files: Ps2SaveFile[];
}

export const readSaveContents = async (
  cardFilePath: string,
  folderName: string
): Promise<Ps2SaveContents | null> => {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(cardFilePath, "r");

    // Read superblock (page 0)
    const sbBuf = Buffer.alloc(PAGE_SIZE);
    const { bytesRead: sbRead } = await fh.read(sbBuf, 0, PAGE_SIZE, 0);
    if (sbRead < PAGE_SIZE) return null;

    const sb = parseSuperBlock(sbBuf);
    if (!sb) return null;

    // Root dir is at allocOffset cluster 0
    const rootOff = sb.allocOffset * CLUSTER_SIZE;

    // Entry 0 = root dir header
    const rootHdr = Buffer.alloc(PAGE_SIZE);
    await fh.read(rootHdr, 0, PAGE_SIZE, rootOff);
    const rootEntry = parseEntry(rootHdr, 0);
    if (!rootEntry) return null;

    const numRootEntries = rootEntry.length;

    // Scan root entries for folderName
    let targetEntry: McFsEntry | null = null;
    let targetEntryBuf: Buffer | null = null;

    for (let i = 1; i < numRootEntries && i < 512; i++) {
      const entryOff = rootOff + i * ENTRY_STRIDE;
      const entryBuf = Buffer.alloc(PAGE_SIZE);
      const { bytesRead } = await fh.read(entryBuf, 0, PAGE_SIZE, entryOff);
      if (bytesRead < 64) continue;
      const entry = parseEntry(entryBuf, 0);
      if (!entry) continue;
      if (!(entry.mode & MC_ATTR_SUBDIR)) continue;
      if (entry.name !== folderName) continue;
      targetEntry = entry;
      targetEntryBuf = entryBuf;
      break;
    }

    if (!targetEntry || !targetEntryBuf) return null;

    // Read save folder's cluster chain
    const folderClusters = await readFatChain(fh, sb, targetEntry.cluster);
    const folderData = await readClusters(fh, sb, folderClusters);

    // Parse file entries from folder data
    const numFiles = targetEntry.length;
    const files: Ps2SaveFile[] = [];

    for (let i = 0; i < numFiles && i * ENTRY_STRIDE < folderData.length; i++) {
      const off = i * ENTRY_STRIDE;
      const entryBuf = folderData.subarray(off, off + PAGE_SIZE);
      if (entryBuf.length < 64) continue;
      const fileEntry = parseEntry(entryBuf, 0);
      if (!fileEntry) continue;
      if (!(fileEntry.mode & MC_ATTR_FILE)) continue;

      const fileClusters = await readFatChain(fh, sb, fileEntry.cluster);
      const rawData = await readClusters(fh, sb, fileClusters);
      // Trim to actual file length
      const fileData = rawData.subarray(0, fileEntry.length);

      const pageBuf = Buffer.alloc(PAGE_SIZE);
      entryBuf.copy(pageBuf, 0, 0, Math.min(entryBuf.length, PAGE_SIZE));
      files.push({ entry: pageBuf, data: fileData });
    }

    return { dirEntry: targetEntryBuf, files };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};

// Scan a PS2 memory card and return all save folder names
export interface Ps2SaveEntry {
  folderName: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: number;
  modifiedAt: number;
}

export const scanPs2MemoryCard = async (
  cardFilePath: string
): Promise<Ps2SaveEntry[]> => {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(cardFilePath, "r");

    const sbBuf = Buffer.alloc(PAGE_SIZE);
    const { bytesRead: sbRead } = await fh.read(sbBuf, 0, PAGE_SIZE, 0);
    if (sbRead < PAGE_SIZE) return [];

    const sb = parseSuperBlock(sbBuf);
    if (!sb) return [];

    const rootOff = sb.allocOffset * CLUSTER_SIZE;
    const rootHdr = Buffer.alloc(PAGE_SIZE);
    await fh.read(rootHdr, 0, PAGE_SIZE, rootOff);
    const rootEntry = parseEntry(rootHdr, 0);
    if (!rootEntry) return [];

    const entries: Ps2SaveEntry[] = [];
    const numRootEntries = Math.min(rootEntry.length, 4096);

    for (let i = 1; i < numRootEntries; i++) {
      const entryOff = rootOff + i * ENTRY_STRIDE;
      const entryBuf = Buffer.alloc(PAGE_SIZE);
      const { bytesRead } = await fh.read(entryBuf, 0, PAGE_SIZE, entryOff);
      if (bytesRead < 64) continue;
      const entry = parseEntry(entryBuf, 0);
      if (!entry) continue;
      if (!(entry.mode & MC_ATTR_SUBDIR) || !entry.name) continue;

      // Read folder to count files and get size
      const folderOff = (sb.allocOffset + entry.cluster) * CLUSTER_SIZE;
      let fileCount = 0;
      let sizeBytes = 0;

      for (let j = 0; j < Math.min(entry.length, 64); j++) {
        const fileEntryOff = folderOff + j * ENTRY_STRIDE;
        const fileBuf = Buffer.alloc(64);
        const { bytesRead: fb } = await fh.read(fileBuf, 0, 64, fileEntryOff);
        if (fb < 64) continue;
        const fileEntry = parseEntry(fileBuf, 0);
        if (!fileEntry || !(fileEntry.mode & MC_ATTR_FILE)) continue;
        fileCount++;
        sizeBytes += fileEntry.length;
      }

      entries.push({
        folderName: entry.name,
        fileCount,
        sizeBytes,
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
      });
    }

    return entries;
  } catch {
    return [];
  } finally {
    await fh?.close();
  }
};

// Build a .psu export buffer from save contents
export const buildPsuBuffer = (contents: Ps2SaveContents): Buffer => {
  const parts: Buffer[] = [contents.dirEntry];

  for (const file of contents.files) {
    parts.push(file.entry);
    // Pad file data to PAGE_SIZE boundary
    const padded =
      Math.ceil(file.data.length / PAGE_SIZE) * PAGE_SIZE || PAGE_SIZE;
    const dataBuf = Buffer.alloc(padded);
    file.data.copy(dataBuf);
    parts.push(dataBuf);
  }

  return Buffer.concat(parts);
};
