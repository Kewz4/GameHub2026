import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type { OverlayStaticImageInventory } from "./overlay-target-static-capability-policy";

export type OverlayPeImportInspectionErrorCode =
  | "invalid-path"
  | "open-failed"
  | "invalid-pe"
  | "unsupported-architecture"
  | "truncated-image"
  | "invalid-rva"
  | "limit-exceeded"
  | "invalid-import-string"
  | "file-changed";

export class OverlayPeImportInspectionError extends Error {
  public constructor(
    public readonly code: OverlayPeImportInspectionErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OverlayPeImportInspectionError";
  }
}

interface PeSection {
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
}

interface PeLayout {
  architecture: "x86" | "x64";
  pointerBytes: 4 | 8;
  imageBase: bigint;
  sizeOfHeaders: number;
  importRva: number;
  importSize: number;
  delayImportRva: number;
  delayImportSize: number;
  sections: readonly PeSection[];
}

const MAX_PE_OFFSET = 0x7fff_ffff;
const MAX_SECTIONS = 96;
const MAX_IMPORT_DESCRIPTORS = 4_096;
const MAX_IMPORTS = 65_536;
const MAX_IMPORT_STRING_BYTES = 512;
const TOKEN_SCAN_CHUNK_BYTES = 1024 * 1024;
const STEAM_INTERFACE_REVISIONS = new Set([
  "SteamInput006",
  "SteamController008",
]);
const INTERFACE_TOKENS = [
  "SteamInput006",
  "SteamController008",
  "Windows.Gaming.Input",
  "GameInputCreate",
] as const;

interface PeFileStamp {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly birthtimeNs: bigint;
}

const fileStamp = (file: number): PeFileStamp => {
  const stat = fs.fstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.size < 64n || stat.size > BigInt(MAX_PE_OFFSET)) {
    throw inspectionError("invalid-pe", "PE image size is invalid.");
  }
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    birthtimeNs: stat.birthtimeNs,
  });
};

const sameFileStamp = (left: PeFileStamp, right: PeFileStamp) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs &&
  left.birthtimeNs === right.birthtimeNs;

const inspectionError = (
  code: OverlayPeImportInspectionErrorCode,
  message: string,
  cause?: unknown
) => new OverlayPeImportInspectionError(code, message, { cause });

const checkedAdd = (left: number, right: number) => {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_PE_OFFSET) {
    throw inspectionError("limit-exceeded", "PE offset exceeded its limit.");
  }
  return result;
};

class PeReader {
  public constructor(
    private readonly file: number,
    public readonly size: number
  ) {}

  public read(offset: number, length: number): Buffer {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      checkedAdd(offset, length) > this.size
    ) {
      throw inspectionError(
        "truncated-image",
        "PE structure extended beyond the file."
      );
    }
    const buffer = Buffer.allocUnsafe(length);
    let cursor = 0;
    while (cursor < length) {
      const bytesRead = fs.readSync(
        this.file,
        buffer,
        cursor,
        length - cursor,
        offset + cursor
      );
      if (bytesRead <= 0) {
        throw inspectionError(
          "truncated-image",
          "PE structure ended before the requested bytes."
        );
      }
      cursor += bytesRead;
    }
    return buffer;
  }
}

const parseLayout = (reader: PeReader): PeLayout => {
  const dos = reader.read(0, 64);
  if (dos.readUInt16LE(0) !== 0x5a4d) {
    throw inspectionError("invalid-pe", "Missing DOS image signature.");
  }
  const peOffset = dos.readUInt32LE(0x3c);
  const signatureAndFileHeader = reader.read(peOffset, 24);
  if (signatureAndFileHeader.readUInt32LE(0) !== 0x0000_4550) {
    throw inspectionError("invalid-pe", "Missing PE image signature.");
  }
  const machine = signatureAndFileHeader.readUInt16LE(4);
  const sectionCount = signatureAndFileHeader.readUInt16LE(6);
  const optionalBytes = signatureAndFileHeader.readUInt16LE(20);
  if (sectionCount < 1 || sectionCount > MAX_SECTIONS) {
    throw inspectionError(
      "limit-exceeded",
      "PE section count exceeded its limit."
    );
  }
  if (optionalBytes < 0x60 || optionalBytes > 0x400) {
    throw inspectionError("invalid-pe", "Invalid PE optional-header size.");
  }

  const optionalOffset = checkedAdd(peOffset, 24);
  const optional = reader.read(optionalOffset, optionalBytes);
  const magic = optional.readUInt16LE(0);
  const architecture =
    machine === 0x8664 && magic === 0x20b
      ? "x64"
      : machine === 0x14c && magic === 0x10b
        ? "x86"
        : null;
  if (!architecture) {
    throw inspectionError(
      "unsupported-architecture",
      "Only x86 and x64 PE images are accepted."
    );
  }
  const pointerBytes = architecture === "x64" ? 8 : 4;
  const directoryOffset = architecture === "x64" ? 112 : 96;
  const directoryCountOffset = architecture === "x64" ? 108 : 92;
  if (optionalBytes < directoryOffset + 14 * 8) {
    throw inspectionError("invalid-pe", "PE data directories are truncated.");
  }
  const directoryCount = optional.readUInt32LE(directoryCountOffset);
  if (directoryCount < 14) {
    throw inspectionError("invalid-pe", "PE import directories are missing.");
  }
  const imageBase =
    architecture === "x64"
      ? optional.readBigUInt64LE(24)
      : BigInt(optional.readUInt32LE(28));
  const sizeOfHeaders = optional.readUInt32LE(60);
  const importRva = optional.readUInt32LE(directoryOffset + 8);
  const importSize = optional.readUInt32LE(directoryOffset + 12);
  const delayImportRva = optional.readUInt32LE(directoryOffset + 13 * 8);
  const delayImportSize = optional.readUInt32LE(directoryOffset + 13 * 8 + 4);

  const sectionOffset = checkedAdd(optionalOffset, optionalBytes);
  const sections: PeSection[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const section = reader.read(checkedAdd(sectionOffset, index * 40), 40);
    sections.push({
      virtualSize: section.readUInt32LE(8),
      virtualAddress: section.readUInt32LE(12),
      rawSize: section.readUInt32LE(16),
      rawOffset: section.readUInt32LE(20),
    });
  }

  // An RVA or raw offset must select exactly one byte range. Accepting
  // overlapping sections would make import parsing dependent on section-table
  // order, which is not a trustworthy static authorization boundary.
  const virtualRanges: Array<Readonly<{ start: number; end: number }>> = [];
  const rawRanges: Array<Readonly<{ start: number; end: number }>> = [];
  for (const section of sections) {
    const mappedSize = Math.max(section.virtualSize, section.rawSize);
    if (mappedSize > 0) {
      const virtualEnd = checkedAdd(section.virtualAddress, mappedSize);
      if (section.virtualAddress < sizeOfHeaders) {
        throw inspectionError(
          "invalid-pe",
          "PE section virtual range overlapped the image headers."
        );
      }
      virtualRanges.push({ start: section.virtualAddress, end: virtualEnd });
    }
    if (section.rawSize > 0) {
      const rawEnd = checkedAdd(section.rawOffset, section.rawSize);
      if (section.rawOffset < sizeOfHeaders || rawEnd > reader.size) {
        throw inspectionError(
          "invalid-pe",
          "PE section raw range overlapped headers or exceeded the file."
        );
      }
      rawRanges.push({ start: section.rawOffset, end: rawEnd });
    }
  }
  const rejectOverlaps = (
    ranges: Array<Readonly<{ start: number; end: number }>>,
    kind: "virtual" | "raw"
  ) => {
    ranges.sort(
      (left, right) => left.start - right.start || left.end - right.end
    );
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index].start < ranges[index - 1].end) {
        throw inspectionError(
          "invalid-pe",
          `PE section ${kind} ranges overlapped.`
        );
      }
    }
  };
  rejectOverlaps(virtualRanges, "virtual");
  rejectOverlaps(rawRanges, "raw");
  return {
    architecture,
    pointerBytes,
    imageBase,
    sizeOfHeaders,
    importRva,
    importSize,
    delayImportRva,
    delayImportSize,
    sections: Object.freeze(sections),
  };
};

const rvaToFile = (
  layout: PeLayout,
  reader: PeReader,
  rva: number,
  minimumBytes = 1
) => {
  if (!Number.isInteger(rva) || rva <= 0) {
    throw inspectionError("invalid-rva", "PE import used an invalid RVA.");
  }
  if (rva < layout.sizeOfHeaders) {
    if (
      checkedAdd(rva, minimumBytes) >
      Math.min(layout.sizeOfHeaders, reader.size)
    ) {
      throw inspectionError(
        "invalid-rva",
        "Header RVA exceeded the image headers."
      );
    }
    return { offset: rva, available: layout.sizeOfHeaders - rva };
  }
  for (const section of layout.sections) {
    const mappedSize = Math.max(section.virtualSize, section.rawSize);
    if (
      rva < section.virtualAddress ||
      rva >= checkedAdd(section.virtualAddress, mappedSize)
    ) {
      continue;
    }
    const relative = rva - section.virtualAddress;
    if (
      relative >= section.rawSize ||
      minimumBytes > section.rawSize - relative
    ) {
      throw inspectionError(
        "invalid-rva",
        "PE RVA referenced virtual data without file backing."
      );
    }
    const offset = checkedAdd(section.rawOffset, relative);
    if (checkedAdd(offset, minimumBytes) > reader.size) {
      throw inspectionError("invalid-rva", "PE RVA exceeded the file.");
    }
    return { offset, available: section.rawSize - relative };
  }
  throw inspectionError("invalid-rva", "PE RVA did not map to a section.");
};

const readImportString = (
  layout: PeLayout,
  reader: PeReader,
  rva: number,
  skipBytes = 0
) => {
  const mapped = rvaToFile(layout, reader, rva, skipBytes + 1);
  const length = Math.min(
    MAX_IMPORT_STRING_BYTES + 1,
    mapped.available - skipBytes
  );
  const bytes = reader.read(mapped.offset + skipBytes, length);
  const end = bytes.indexOf(0);
  if (end < 1 || end > MAX_IMPORT_STRING_BYTES) {
    throw inspectionError(
      "invalid-import-string",
      "PE import string was empty or unterminated."
    );
  }
  const value = bytes.subarray(0, end);
  if ([...value].some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw inspectionError(
      "invalid-import-string",
      "PE import string was not printable ASCII."
    );
  }
  return value.toString("ascii");
};

const readThunkValue = (buffer: Buffer, pointerBytes: 4 | 8) =>
  pointerBytes === 8
    ? buffer.readBigUInt64LE(0)
    : BigInt(buffer.readUInt32LE(0));

const collectThunks = (
  layout: PeLayout,
  reader: PeReader,
  thunkRva: number,
  module: string,
  delayLoaded: boolean,
  destination: OverlayStaticImageInventory["imports"] extends readonly (infer T)[]
    ? T[]
    : never
) => {
  const ordinalMask = layout.pointerBytes === 8 ? 1n << 63n : 1n << 31n;
  for (let index = 0; index < MAX_IMPORTS; index += 1) {
    const entryRva = checkedAdd(thunkRva, index * layout.pointerBytes);
    const mapped = rvaToFile(layout, reader, entryRva, layout.pointerBytes);
    const value = readThunkValue(
      reader.read(mapped.offset, layout.pointerBytes),
      layout.pointerBytes
    );
    if (value === 0n) return;
    const symbol =
      (value & ordinalMask) !== 0n
        ? `#${(value & 0xffffn).toString()}`
        : readImportString(layout, reader, Number(value), 2);
    destination.push(Object.freeze({ module, symbol, delayLoaded }));
  }
  throw inspectionError(
    "limit-exceeded",
    "PE import thunk count exceeded its limit."
  );
};

const collectNormalImports = (
  layout: PeLayout,
  reader: PeReader,
  imports: Array<{ module: string; symbol: string; delayLoaded: boolean }>
) => {
  if (layout.importRva === 0 && layout.importSize === 0) return;
  if (layout.importRva === 0 || layout.importSize < 20) {
    throw inspectionError("invalid-pe", "Invalid PE import directory.");
  }
  const descriptorLimit = Math.min(
    Math.floor(layout.importSize / 20),
    MAX_IMPORT_DESCRIPTORS
  );
  for (let index = 0; index < descriptorLimit; index += 1) {
    const descriptorRva = checkedAdd(layout.importRva, index * 20);
    const mapped = rvaToFile(layout, reader, descriptorRva, 20);
    const descriptor = reader.read(mapped.offset, 20);
    if (descriptor.every((byte) => byte === 0)) return;
    const originalThunk = descriptor.readUInt32LE(0);
    const moduleRva = descriptor.readUInt32LE(12);
    const firstThunk = descriptor.readUInt32LE(16);
    const thunkRva = originalThunk || firstThunk;
    if (!moduleRva || !thunkRva) {
      throw inspectionError("invalid-pe", "Invalid PE import descriptor.");
    }
    const module = readImportString(layout, reader, moduleRva);
    collectThunks(layout, reader, thunkRva, module, false, imports);
    if (imports.length > MAX_IMPORTS) {
      throw inspectionError(
        "limit-exceeded",
        "PE import count exceeded its limit."
      );
    }
  }
  throw inspectionError(
    "limit-exceeded",
    "PE import descriptors were not terminated."
  );
};

const delayFieldToRva = (
  layout: PeLayout,
  attributes: number,
  value: number
) => {
  if ((attributes & 1) !== 0) return value;
  if (layout.pointerBytes === 8 || BigInt(value) <= layout.imageBase) {
    throw inspectionError("invalid-rva", "Unsupported VA-based delay import.");
  }
  const rva = BigInt(value) - layout.imageBase;
  if (rva <= 0n || rva > BigInt(MAX_PE_OFFSET)) {
    throw inspectionError("invalid-rva", "Invalid delay-import VA.");
  }
  return Number(rva);
};

const collectDelayImports = (
  layout: PeLayout,
  reader: PeReader,
  imports: Array<{ module: string; symbol: string; delayLoaded: boolean }>
) => {
  if (layout.delayImportRva === 0 && layout.delayImportSize === 0) return;
  if (layout.delayImportRva === 0 || layout.delayImportSize < 32) {
    throw inspectionError("invalid-pe", "Invalid PE delay-import directory.");
  }
  const descriptorLimit = Math.min(
    Math.floor(layout.delayImportSize / 32),
    MAX_IMPORT_DESCRIPTORS
  );
  for (let index = 0; index < descriptorLimit; index += 1) {
    const descriptorRva = checkedAdd(layout.delayImportRva, index * 32);
    const mapped = rvaToFile(layout, reader, descriptorRva, 32);
    const descriptor = reader.read(mapped.offset, 32);
    if (descriptor.every((byte) => byte === 0)) return;
    const attributes = descriptor.readUInt32LE(0);
    const moduleRva = delayFieldToRva(
      layout,
      attributes,
      descriptor.readUInt32LE(4)
    );
    const importNameTableRva = delayFieldToRva(
      layout,
      attributes,
      descriptor.readUInt32LE(16)
    );
    const module = readImportString(layout, reader, moduleRva);
    collectThunks(layout, reader, importNameTableRva, module, true, imports);
    if (imports.length > MAX_IMPORTS) {
      throw inspectionError(
        "limit-exceeded",
        "PE import count exceeded its limit."
      );
    }
  }
  throw inspectionError(
    "limit-exceeded",
    "PE delay-import descriptors were not terminated."
  );
};

const scanInterfaceTokens = (file: number, size: number) => {
  const tokens = INTERFACE_TOKENS.map((value) => ({
    value,
    encodings: [Buffer.from(value, "ascii"), Buffer.from(value, "utf16le")],
  }));
  const maximumToken = Math.max(
    ...tokens.flatMap((token) =>
      token.encodings.map((encoding) => encoding.length)
    )
  );
  const found = new Set<string>();
  const contentHash = createHash("sha256");
  let overlap = Buffer.alloc(0);
  for (let offset = 0; offset < size; offset += TOKEN_SCAN_CHUNK_BYTES) {
    const length = Math.min(TOKEN_SCAN_CHUNK_BYTES, size - offset);
    const chunk = Buffer.allocUnsafe(length);
    const read = fs.readSync(file, chunk, 0, length, offset);
    if (read !== length) {
      throw inspectionError(
        "truncated-image",
        "PE token scan ended before the file size."
      );
    }
    contentHash.update(chunk);
    const window = Buffer.concat([overlap, chunk]);
    for (const token of tokens) {
      if (token.encodings.some((encoding) => window.indexOf(encoding) >= 0)) {
        found.add(token.value);
      }
    }
    overlap = window.subarray(Math.max(0, window.length - maximumToken + 1));
  }
  return Object.freeze({
    embeddedInterfaceTokens: Object.freeze([...found].sort()),
    contentSha256: contentHash.digest("hex"),
  });
};

/**
 * Bounded static prefilter only. The production supervisor must independently
 * pin and revalidate the exact file handle/identity used for launch; a pathname
 * inspection is never authorization and cannot prove runtime module absence.
 */
export const inspectOverlayPeImports = (
  unsafePath: string
): OverlayStaticImageInventory => {
  if (typeof unsafePath !== "string" || !path.isAbsolute(unsafePath)) {
    throw inspectionError(
      "invalid-path",
      "PE inspection requires an absolute path."
    );
  }
  let canonicalPath: string;
  let file: number;
  try {
    canonicalPath = fs.realpathSync.native(unsafePath);
    file = fs.openSync(canonicalPath, "r");
  } catch (error) {
    throw inspectionError("open-failed", "Unable to open the PE image.", error);
  }
  try {
    const initialStamp = fileStamp(file);
    const size = Number(initialStamp.size);
    const reader = new PeReader(file, size);
    const layout = parseLayout(reader);
    const imports: Array<{
      module: string;
      symbol: string;
      delayLoaded: boolean;
    }> = [];
    collectNormalImports(layout, reader, imports);
    collectDelayImports(layout, reader, imports);
    const deduplicated = [
      ...new Map(
        imports.map((item) => [
          `${item.module.toLowerCase()}\0${item.symbol.toLowerCase()}\0${item.delayLoaded}`,
          item,
        ])
      ).values(),
    ];
    const { embeddedInterfaceTokens, contentSha256 } = scanInterfaceTokens(
      file,
      size
    );
    if (!sameFileStamp(initialStamp, fileStamp(file))) {
      throw inspectionError(
        "file-changed",
        "PE image identity, size, or timestamps changed during inspection."
      );
    }
    return Object.freeze({
      canonicalPath,
      contentSha256,
      architecture: layout.architecture,
      completeImportSnapshot: true,
      imports: Object.freeze(deduplicated.map((item) => Object.freeze(item))),
      referencedSymbols: Object.freeze(
        [...new Set(deduplicated.map((item) => item.symbol))].sort()
      ),
      embeddedInterfaceRevisions: Object.freeze(
        embeddedInterfaceTokens.filter((value) =>
          STEAM_INTERFACE_REVISIONS.has(value)
        )
      ),
      embeddedInterfaceTokens,
    });
  } finally {
    fs.closeSync(file);
  }
};
