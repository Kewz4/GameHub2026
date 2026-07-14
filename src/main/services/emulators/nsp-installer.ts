import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEmulatorConfig } from "./emulators-repository";
import { logger } from "../logger";

/**
 * Headless NSP installer for the Eden (Switch) emulator.
 *
 * Eden (a Yuzu/Sudachi derivative) installs NSP files by extracting the NCA
 * archives from the PFS0 container and placing them in the NAND registered
 * cache at `nand/system/Contents/registered/`. Eden has no CLI install command,
 * so we replicate the install process directly:
 *
 * 1. Parse the PFS0 header to locate NCA files inside the NSP.
 * 2. For each NCA, the filename IS the NcaID (32-char hex = 16 bytes).
 * 3. Compute SHA-256 of the 16-byte NcaID; the first byte determines the
 *    two-digit subdirectory (`000000{XX}`).
 * 4. Write the full NCA to `registered/000000{XX}/{ncaId}.nca`.
 * 5. On next launch, Eden's RegisteredCache::Refresh() scans the directory
 *    and picks up the new content automatically.
 *
 * This mirrors `RegisteredCache::RawInstallNCA` in Eden's
 * `src/core/file_sys/registered_cache.cpp`, which uses `override_id` (the
 * NcaID from the NSP's filename) rather than computing a hash of the NCA
 * data. The directory is derived from `GetRelativePathFromNcaID`:
 *   SHA256(ncaId)[0] → `000000{:02X}` directory.
 */

const PFS0_MAGIC = 0x30534650; // "PFS0" little-endian

interface Pfs0FileEntry {
  offset: number;
  size: number;
  name: string;
}

function parsePfs0Header(filePath: string): {
  entries: Pfs0FileEntry[];
  dataOffset: number;
} | null {
  const fd = fs.openSync(filePath, "r");

  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, header, 0, 16, 0);
    if (bytesRead < 16) return null;

    const magic = header.readUInt32LE(0);
    if (magic !== PFS0_MAGIC) return null;

    const numFiles = header.readUInt32LE(4);
    const stringTableSize = header.readUInt32LE(8);
    // header[12..16] = reserved

    const fileEntrySize = 24;
    const fileEntriesBuf = Buffer.alloc(numFiles * fileEntrySize);
    fs.readSync(fd, fileEntriesBuf, 0, fileEntriesBuf.length, 16);

    const stringTableBuf = Buffer.alloc(stringTableSize);
    fs.readSync(fd, stringTableBuf, 0, stringTableSize, 16 + numFiles * fileEntrySize);

    const dataOffset = 16 + numFiles * fileEntrySize + stringTableSize;

    const entries: Pfs0FileEntry[] = [];
    for (let i = 0; i < numFiles; i++) {
      const base = i * fileEntrySize;
      const offset = Number(fileEntriesBuf.readBigUInt64LE(base));
      const size = Number(fileEntriesBuf.readBigUInt64LE(base + 8));
      const nameOffset = fileEntriesBuf.readUInt32LE(base + 16);

      // Read null-terminated string from string table
      const nameEnd = stringTableBuf.indexOf(0, nameOffset);
      const name = stringTableBuf.toString(
        "utf8",
        nameOffset,
        nameEnd === -1 ? stringTableSize : nameEnd
      );

      entries.push({ offset, size, name });
    }

    return { entries, dataOffset };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Compute the two-digit subdirectory for an NCA ID.
 * SHA-256 of the 16-byte NcaID → first byte → `000000{XX}`.
 */
function ncaDirectory(ncaIdHex: string): string {
  const ncaId = Buffer.from(ncaIdHex, "hex");
  const hash = crypto.createHash("sha256").update(ncaId).digest();
  return `000000${hash[0].toString(16).padStart(2, "0").toUpperCase()}`;
}

/**
 * Install an NSP file into Eden's NAND registered cache.
 *
 * @param nspPath Absolute path to the .nsp file.
 * @returns `true` if at least one NCA was installed.
 */
export async function installNspIntoEden(nspPath: string): Promise<boolean> {
  const config = await getEmulatorConfig("switch").catch(() => null);
  if (config?.binary !== "eden" || !config.executablePath) {
    logger.warn(
      `[nsp-install] Eden not configured — .nsp left for manual install: ${nspPath}`
    );
    return false;
  }

  const installDir = path.dirname(config.executablePath);
  const registeredDir = path.join(
    installDir,
    "nand",
    "system",
    "Contents",
    "registered"
  );

  const parsed = parsePfs0Header(nspPath);
  if (!parsed) {
    logger.warn(`[nsp-install] Not a valid PFS0/NSP file: ${nspPath}`);
    return false;
  }

  const { entries, dataOffset } = parsed;
  const ncaEntries = entries.filter(
    (e) => e.name.endsWith(".nca") || e.name.endsWith(".cnmt.nca")
  );

  if (ncaEntries.length === 0) {
    logger.warn(`[nsp-install] No NCA files found in ${nspPath}`);
    return false;
  }

  let installed = 0;
  const fd = fs.openSync(nspPath, "r");

  try {
    for (const entry of ncaEntries) {
      // The NCA filename (without .nca) IS the 32-char hex NcaID.
      const ncaIdHex = entry.name.replace(/\.cnmt\.nca$|\.nca$/i, "");

      if (ncaIdHex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(ncaIdHex)) {
        logger.warn(`[nsp-install] Skipping NCA with invalid name: ${entry.name}`);
        continue;
      }

      const dir = ncaDirectory(ncaIdHex);
      const destDir = path.join(registeredDir, dir);
      const destFile = path.join(destDir, entry.name.toLowerCase());

      fs.mkdirSync(destDir, { recursive: true });

      // Copy the NCA data from the NSP to the registered directory.
      // Stream in 4MB chunks to avoid loading the whole NCA into memory.
      const BUF_SIZE = 4 * 1024 * 1024;
      const buf = Buffer.alloc(BUF_SIZE);
      let remaining = entry.size;
      let srcOffset = dataOffset + entry.offset;

      const outFd = fs.openSync(destFile, "w");
      try {
        while (remaining > 0) {
          const toRead = Math.min(BUF_SIZE, remaining);
          const read = fs.readSync(fd, buf, 0, toRead, srcOffset);
          if (read <= 0) break;
          fs.writeSync(outFd, buf, 0, read);
          srcOffset += read;
          remaining -= read;
        }
      } finally {
        fs.closeSync(outFd);
      }

      installed++;
      logger.log(
        `[nsp-install] Installed NCA: ${entry.name} → ${path.relative(installDir, destFile)}`
      );
    }
  } finally {
    fs.closeSync(fd);
  }

  logger.log(
    `[nsp-install] Done: ${installed} NCA(s) installed from ${path.basename(nspPath)}`
  );
  return installed > 0;
}
