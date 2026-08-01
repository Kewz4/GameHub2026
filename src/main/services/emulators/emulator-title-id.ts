import fs from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";

/**
 * Unified per-title save resolution for the ID-based console emulators.
 *
 * Rather than hardcode each emulator's exact save-path template (fragile: the
 * layouts encode the id differently — 3DS derives an extdata id, Wii hex-encodes
 * the game code, Switch nests under a user UUID), we resolve the game's platform
 * ID and then SEARCH the emulator's save tree for a folder/file carrying it.
 * This is safe by construction: it can only ever match a real folder that
 * contains the id, and when nothing matches (no save yet, or the id couldn't be
 * read) callers fall back to the whole console save root — never a wrong target.
 *
 * ID sources are authoritative + offline (no fuzzy name matching):
 *   - Switch: the title id in the NSP's ticket (rights id), else the dump
 *     filename (`[0100XXXXXXXXXXXX]`).
 *   - 3DS: the title id from the dump filename (`0004xxxxxxxxxxxx`).
 *   - Wii: the 6-char game code from the disc header, hex-encoded like the save
 *     folder (`title/00010000/<hex(code[0:4])>`).
 * PS3 (games.yml) and Wii U (meta.xml) keep their existing precise resolvers.
 */

const HEX16 = /\b((?:0100|0004|0005)[0-9a-f]{12})\b/i;

const formatLittleEndianTitleId = (value: Buffer): string =>
  Buffer.from(value).reverse().toString("hex").toLowerCase();

const isUsableTitleId = (value: string): boolean =>
  /^[0-9a-f]{16}$/.test(value) && value !== "0".repeat(16);

/** Read the Switch title id (16 hex) from an NSP's embedded ticket, if present. */
function readNspTitleId(romPath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(romPath, "r");
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.toString("ascii", 0, 4) !== "PFS0") return null; // not a PFS0 NSP
    const fileCount = head.readUInt32LE(4);
    const stringTableSize = head.readUInt32LE(8);
    const entryTableOffset = 16;
    const entrySize = 0x18;
    const stringTableOffset = entryTableOffset + fileCount * entrySize;
    const dataOffset = stringTableOffset + stringTableSize;

    const entries = Buffer.alloc(fileCount * entrySize);
    fs.readSync(fd, entries, 0, entries.length, entryTableOffset);
    const strings = Buffer.alloc(stringTableSize);
    fs.readSync(fd, strings, 0, stringTableSize, stringTableOffset);

    for (let i = 0; i < fileCount; i++) {
      const base = i * entrySize;
      const fileDataOffset = Number(entries.readBigUInt64LE(base));
      const strOffset = entries.readUInt32LE(base + 0x10);
      const end = strings.indexOf(0, strOffset);
      const name = strings.toString(
        "ascii",
        strOffset,
        end === -1 ? undefined : end
      );
      if (name.toLowerCase().endsWith(".tik")) {
        // Ticket rights id is at 0x2A0; its first 8 bytes are the title id (BE).
        const tik = Buffer.alloc(8);
        fs.readSync(fd, tik, 0, 8, dataOffset + fileDataOffset + 0x2a0);
        const titleId = tik.toString("hex");
        if (/^[0-9a-f]{16}$/.test(titleId) && titleId !== "0".repeat(16)) {
          return titleId;
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Convert a Switch update/AOC title id to the base application's title id.
 *
 * Switch updates use `base + 0x800`. AOC ids normally occupy the following
 * 0x1000 block (`base + 0x1000 + index`). Some filename sets also use the
 * older `...0c00` DLC convention that GameHub already recognises, so preserve
 * compatibility with it as well. Base ids whose low 12 bits are zero are
 * returned unchanged (including games such as Echoes of Wisdom whose base id
 * ends in `c000`, rather than the often-assumed `0000`).
 */
export function normalizeSwitchTitleId(titleId: string): string | null {
  const normalized = titleId.trim().toLowerCase();
  if (!isUsableTitleId(normalized) || !normalized.startsWith("0100")) {
    return null;
  }

  let numeric = BigInt(`0x${normalized}`);
  const low = Number(numeric & 0xfffn);

  if (low === 0x800) {
    numeric -= 0x800n;
  } else if (low > 0 && low < 0x800) {
    // AOC ids live in the 0x1000 block immediately after the base title. Drop
    // the content index and then step back to the application's block.
    numeric = (numeric & ~0xfffn) - 0x1000n;
  } else if (low === 0xc00) {
    // Compatibility with the `...0c00` DLC naming convention accepted by the
    // existing ROM classifier.
    numeric -= 0xc00n;
  }

  return numeric.toString(16).padStart(16, "0");
}

/**
 * Read a 3DS title id directly from an NCSD cartridge image (`.3ds`/`.cci`) or
 * an NCCH executable image (`.cxi`). Both formats store the 64-bit id little
 * endian in their fixed header. This avoids depending on filenames containing
 * a title id, which normal No-Intro names generally do not.
 */
export function read3dsTitleId(romPath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(romPath, "r");
    const header = Buffer.alloc(0x200);
    const read = fs.readSync(fd, header, 0, header.length, 0);
    if (read < 0x120) return null;

    const magic = header.toString("ascii", 0x100, 0x104);
    if (magic === "NCCH") {
      const titleId = formatLittleEndianTitleId(header.subarray(0x118, 0x120));
      return isUsableTitleId(titleId) ? titleId : null;
    }
    if (magic !== "NCSD") return null;

    // 0x108 in an NCSD header is the media id. It often equals the application
    // id, but the authoritative program id lives in the first NCCH partition.
    // Partition offsets begin at 0x120 and are expressed in 0x200-byte media
    // units. Probe every declared partition and accept only a real NCCH header.
    for (let partition = 0; partition < 8; partition++) {
      const tableOffset = 0x120 + partition * 8;
      const mediaUnitOffset = header.readUInt32LE(tableOffset);
      if (mediaUnitOffset === 0) continue;

      const partitionOffset = mediaUnitOffset * 0x200;
      const ncch = Buffer.alloc(0x200);
      const partitionRead = fs.readSync(
        fd,
        ncch,
        0,
        ncch.length,
        partitionOffset
      );
      if (
        partitionRead < 0x120 ||
        ncch.toString("ascii", 0x100, 0x104) !== "NCCH"
      ) {
        continue;
      }

      const titleId = formatLittleEndianTitleId(ncch.subarray(0x118, 0x120));
      if (isUsableTitleId(titleId)) return titleId;
    }

    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Read a GameCube/Wii disc's 6-char game code from the header (raw images). */
function readDiscGameCode(romPath: string): string | null {
  const ext = path.extname(romPath).toLowerCase();
  // Only raw, uncompressed images carry the code at offset 0. .rvz/.wia are
  // compressed and .wbfs has a wrapper — skip those (fall back to console-wide).
  if (![".iso", ".gcm", ".ciso"].includes(ext)) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(romPath, "r");
    const buf = Buffer.alloc(6);
    fs.readSync(fd, buf, 0, 6, 0);
    const code = buf.toString("ascii");
    return /^[A-Z0-9]{6}$/.test(code) ? code : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * The string to search the save tree for, to find THIS game's save folder.
 * Returns null when no id can be derived (→ caller uses the console-wide root).
 */
export function resolveConsoleSaveNeedle(
  system: EmulatorSystem,
  romPath: string | null | undefined
): string | null {
  if (!romPath) return null;
  const base = path.basename(romPath);

  if (system === "switch") {
    const fromNsp = readNspTitleId(romPath);
    if (fromNsp) return normalizeSwitchTitleId(fromNsp);
    const m = HEX16.exec(base);
    return m ? normalizeSwitchTitleId(m[1]) : null;
  }

  if (system === "n3ds") {
    const fromImage = read3dsTitleId(romPath);
    if (fromImage) return fromImage;
    const m = HEX16.exec(base);
    return m ? m[1].toLowerCase() : null;
  }

  if (system === "wii") {
    const code = readDiscGameCode(romPath);
    if (!code) return null;
    // Wii disc saves live at title/00010000/<hex(code[0:4])>/ — the first four
    // ASCII chars of the game code, hex-encoded.
    return Buffer.from(code.slice(0, 4), "ascii").toString("hex").toLowerCase();
  }

  return null;
}

/**
 * Walk each save root (bounded) and return directories whose name contains the
 * needle (case-insensitive). Empty when nothing matches → caller falls back.
 */
export function searchSaveTreeForNeedle(
  roots: string[],
  needle: string
): string[] {
  const wanted = needle.toLowerCase();
  const matches: string[] = [];
  let visited = 0;
  const stack = [...roots];
  while (stack.length && visited < 20_000) {
    const dir = stack.pop()!;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(wanted)) matches.push(full);
      else stack.push(full);
    }
  }
  return matches;
}

/**
 * Azahar stores a 3DS title id as two adjacent directory components:
 * `<high-8>/<low-8>` (for example `00040000/00033600`). A generic substring
 * search for the full 16-hex id can therefore never match it. Return only the
 * complete per-title directories whose two components form the requested id.
 */
export function searchAzaharSaveTreeForTitleId(
  roots: string[],
  titleId: string
): string[] {
  const wanted = titleId.toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(wanted)) return [];

  const high = wanted.slice(0, 8);
  const low = wanted.slice(8);
  const matches: string[] = [];
  const stack = [...roots];
  let visited = 0;

  while (stack.length && visited < 20_000) {
    const dir = stack.pop()!;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const parentName = path.basename(dir).toLowerCase();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (parentName === high && entry.name.toLowerCase() === low) {
        matches.push(full);
        // This directory is already the isolated title root. Do not descend
        // and accidentally return nested data/extdata folders as duplicates.
        continue;
      }
      stack.push(full);
    }
  }

  return matches;
}
