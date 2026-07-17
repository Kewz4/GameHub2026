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
    if (fromNsp) return fromNsp;
    const m = HEX16.exec(base);
    return m ? m[1].toLowerCase() : null;
  }

  if (system === "n3ds") {
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
