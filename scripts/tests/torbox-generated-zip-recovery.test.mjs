import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildStoredZip64Trailer,
  finishCrc32,
  parseStoredZip64LocalHeader,
  updateCrc32,
} from "../recover-torbox-generated-zip.mjs";

function makeStreamingZip64Header(filename) {
  const name = Buffer.from(filename);
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);

  const header = Buffer.alloc(30 + name.length + extra.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(0x0008, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0xffffffff, 18);
  header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);
  name.copy(header, 30);
  extra.copy(header, 30 + name.length);
  return header;
}

test("finalizes a streaming one-file STORE ZIP64 without rewriting its payload", () => {
  const filename = "folder/game.rar";
  const raw = Buffer.from("GameHub resume recovery fixture\n".repeat(100));
  const localHeader = makeStreamingZip64Header(filename);
  const header = parseStoredZip64LocalHeader(localHeader);
  const crc32 = finishCrc32(updateCrc32(0xffffffff, raw));
  const baseTrailerSize = 196 + header.filename.length;
  const expectedTotalSize =
    localHeader.length + raw.length + baseTrailerSize + 17;
  const trailer = buildStoredZip64Trailer({
    header,
    rawSize: raw.length,
    crc32,
    expectedTotalSize,
  });
  const archive = Buffer.concat([localHeader, raw, trailer]);

  assert.equal(archive.length, expectedTotalSize);
  assert.equal(archive.readUInt32LE(archive.length - 22 - 17), 0x06054b50);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-zip64-test-"));
  const archivePath = path.join(tempDir, "fixture.zip");
  fs.writeFileSync(archivePath, archive);
  try {
    const output = execFileSync(
      "python",
      [
        "-c",
        "import sys,zipfile; p=sys.argv[1]; n=sys.argv[2]; z=zipfile.ZipFile(p); d=z.read(n); print(len(d)); z.testzip()",
        archivePath,
        filename,
      ],
      { encoding: "utf8" }
    ).trim();
    assert.equal(output, String(raw.length));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
