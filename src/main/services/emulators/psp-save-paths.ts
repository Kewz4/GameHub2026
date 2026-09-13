import fs from "node:fs";
import path from "node:path";

const SECTOR = 2048;
const MAX_SFO_BYTES = 1024 * 1024;
const MAX_DIRECTORY_BYTES = 256 * 1024;

export const normalizePspDiscId = (value?: string | null): string | null => {
  const normalized = value?.trim().replace(/[-_]/g, "").toUpperCase();
  return normalized && /^[A-Z]{4}\d{5}$/.test(normalized) ? normalized : null;
};

export const parsePspDiscId = (sfo: Buffer): string | null => {
  if (sfo.length < 20 || sfo.readUInt32LE(0) !== 0x46535000) return null;
  const keys = sfo.readUInt32LE(8);
  const data = sfo.readUInt32LE(12);
  const count = sfo.readUInt32LE(16);
  if (
    count > 4096 ||
    20 + count * 16 > sfo.length ||
    keys >= sfo.length ||
    data > sfo.length
  )
    return null;
  for (let index = 0; index < count; index++) {
    const entry = 20 + index * 16;
    const keyStart = keys + sfo.readUInt16LE(entry);
    const keyEnd = sfo.indexOf(0, keyStart);
    if (
      keyStart < keys ||
      keyStart >= data ||
      keyEnd < keyStart ||
      keyEnd >= data
    )
      continue;
    if (sfo.toString("ascii", keyStart, keyEnd) !== "DISC_ID") continue;
    const start = data + sfo.readUInt32LE(entry + 12);
    const size = sfo.readUInt32LE(entry + 4);
    if (size > 64 || start > sfo.length || start + size > sfo.length)
      return null;
    return normalizePspDiscId(
      sfo.toString("ascii", start, start + size).replace(/\0+$/, "")
    );
  }
  return null;
};

interface IsoEntry {
  name: string;
  offset: number;
  size: number;
  directory: boolean;
}
const isoEntries = (data: Buffer): IsoEntry[] => {
  const entries: IsoEntry[] = [];
  for (let at = 0; at < data.length; ) {
    const length = data[at];
    if (!length) {
      at = (Math.floor(at / SECTOR) + 1) * SECTOR;
      continue;
    }
    if (length < 34 || at + length > data.length) break;
    const nameLength = data[at + 32];
    if (33 + nameLength > length) break;
    entries.push({
      name: data
        .toString("ascii", at + 33, at + 33 + nameLength)
        .replace(/;\d+$/, ""),
      offset: data.readUInt32LE(at + 2) * SECTOR,
      size: data.readUInt32LE(at + 10),
      directory: (data[at + 25] & 2) !== 0,
    });
    at += length;
  }
  return entries;
};

/** Reads only bounded metadata from ISO/PBP or an unpacked PSP_GAME folder.
 * Filename guesses are deliberately not a title identity for save restore. */
export const readPspDiscId = (romPath: string): string | null => {
  let fd: number | null = null;
  try {
    if (fs.statSync(romPath).isDirectory()) {
      for (const file of [
        path.join(romPath, "PSP_GAME", "PARAM.SFO"),
        path.join(romPath, "PARAM.SFO"),
      ]) {
        try {
          if (fs.statSync(file).size <= MAX_SFO_BYTES) {
            const id = parsePspDiscId(fs.readFileSync(file));
            if (id) return id;
          }
        } catch {
          /* Try the other supported unpacked layout. */
        }
      }
      return null;
    }
    const ext = path.extname(romPath).toLowerCase();
    if (ext !== ".iso" && ext !== ".pbp") return null;
    fd = fs.openSync(romPath, "r");
    const size = fs.fstatSync(fd).size;
    const read = (
      offset: number,
      length: number,
      cap: number
    ): Buffer | null => {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length <= 0 ||
        length > cap ||
        offset + length > size
      )
        return null;
      const data = Buffer.alloc(length);
      return fs.readSync(fd!, data, 0, length, offset) === length ? data : null;
    };
    if (ext === ".pbp") {
      const header = read(0, 40, 40);
      if (!header || header.readUInt32LE(0) !== 0x50425000) return null;
      const start = header.readUInt32LE(8);
      const end = header.readUInt32LE(12);
      if (start < 40 || end <= start) return null;
      const data = read(start, end - start, MAX_SFO_BYTES);
      return data ? parsePspDiscId(data) : null;
    }
    const pvd = read(16 * SECTOR, SECTOR, SECTOR);
    if (!pvd || pvd[0] !== 1 || pvd.toString("ascii", 1, 6) !== "CD001")
      return null;
    const root = read(
      pvd.readUInt32LE(158) * SECTOR,
      pvd.readUInt32LE(166),
      MAX_DIRECTORY_BYTES
    );
    const game =
      root &&
      isoEntries(root).find(
        (entry) => entry.name === "PSP_GAME" && entry.directory
      );
    if (!game) return null;
    const listing = read(game.offset, game.size, MAX_DIRECTORY_BYTES);
    const param =
      listing &&
      isoEntries(listing).find(
        (entry) => entry.name === "PARAM.SFO" && !entry.directory
      );
    if (!param) return null;
    const sfo = read(param.offset, param.size, MAX_SFO_BYTES);
    return sfo ? parsePspDiscId(sfo) : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
};

export const isPspSaveDirectoryForTitle = (
  name: string,
  identity: string
): boolean => {
  const id = normalizePspDiscId(identity);
  return (
    !!id &&
    /^[A-Z]{4}\d{5}[A-Z0-9_-]*$/i.test(name) &&
    name.toUpperCase().startsWith(id)
  );
};

export const findPspSaveDirectories = (
  roots: readonly string[],
  identity: string
): string[] => {
  if (!normalizePspDiscId(identity)) return [];
  const result: string[] = [];
  for (const root of roots) {
    try {
      for (const entry of fs
        .readdirSync(root, { withFileTypes: true })
        .slice(0, 20_000)) {
        if (
          entry.isDirectory() &&
          isPspSaveDirectoryForTitle(entry.name, identity)
        )
          result.push(path.join(root, entry.name));
      }
    } catch {
      /* No saves created yet. */
    }
  }
  return result;
};

export const buildPspRestorePatterns = (
  roots: readonly string[],
  identity: string
): string[] => {
  const id = normalizePspDiscId(identity);
  return id ? roots.map((root) => path.join(root, `${id}*`)) : [];
};
