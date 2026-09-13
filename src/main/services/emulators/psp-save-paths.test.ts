import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPspRestorePatterns,
  findPspSaveDirectories,
  normalizePspDiscId,
  parsePspDiscId,
  readPspDiscId,
} from "./psp-save-paths";
import {
  buildEmulatorRestorePatterns,
  findRalibretroSaveFiles,
} from "./emulator-save-paths";

const sfo = (id: string) => {
  const key = Buffer.from("DISC_ID\0");
  const value = Buffer.from(`${id}\0`);
  const result = Buffer.alloc(36 + key.length + value.length);
  result.writeUInt32LE(0x46535000);
  result.writeUInt32LE(36, 8);
  result.writeUInt32LE(36 + key.length, 12);
  result.writeUInt32LE(1, 16);
  result.writeUInt16LE(0x0204, 22);
  result.writeUInt32LE(value.length, 24);
  result.writeUInt32LE(value.length, 28);
  key.copy(result, 36);
  value.copy(result, 36 + key.length);
  return result;
};

test("PSP identity accepts exact disc serials and rejects traversal or arbitrary title guesses", () => {
  assert.equal(normalizePspDiscId("ulus-12345"), "ULUS12345");
  assert.equal(normalizePspDiscId("../ULUS12345"), null);
  assert.equal(parsePspDiscId(sfo("ULUS12345")), "ULUS12345");
  assert.equal(parsePspDiscId(sfo("../../other")), null);
  const malformed = sfo("ULUS12345");
  malformed.writeUInt32LE(0xfffffff0, 12);
  assert.equal(parsePspDiscId(malformed), null);
});

test("PSP reader extracts DISC_ID from bounded PBP and ISO metadata, not ROM filename", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-psp-id-"));
  try {
    const param = sfo("ULUS12345");
    const pbp = Buffer.alloc(40 + param.length);
    pbp.writeUInt32LE(0x50425000);
    pbp.writeUInt32LE(40, 8);
    pbp.writeUInt32LE(pbp.length, 12);
    param.copy(pbp, 40);
    const pbpFile = path.join(root, "Misleading [ULUS99999].pbp");
    fs.writeFileSync(pbpFile, pbp);
    assert.equal(readPspDiscId(pbpFile), "ULUS12345");
    const iso = Buffer.alloc(24 * 2048);
    const pvd = 16 * 2048;
    iso[pvd] = 1;
    iso.write("CD001", pvd + 1);
    iso.writeUInt32LE(20, pvd + 158);
    iso.writeUInt32LE(2048, pvd + 166);
    const record = (
      at: number,
      name: string,
      sector: number,
      size: number,
      directory: boolean
    ) => {
      iso[at] = 34 + name.length;
      iso.writeUInt32LE(sector, at + 2);
      iso.writeUInt32LE(size, at + 10);
      iso[at + 25] = directory ? 2 : 0;
      iso[at + 32] = name.length;
      iso.write(name, at + 33);
    };
    record(20 * 2048, "PSP_GAME", 21, 2048, true);
    record(21 * 2048, "PARAM.SFO;1", 22, param.length, false);
    param.copy(iso, 22 * 2048);
    const isoFile = path.join(root, "Test.iso");
    fs.writeFileSync(isoFile, iso);
    assert.equal(readPspDiscId(isoFile), "ULUS12345");
    fs.writeFileSync(isoFile, "Not an ISO [ULUS12345]");
    assert.equal(readPspDiscId(isoFile), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("PSP save discovery isolates every save slot for one serial, never sibling games or shared root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-psp-saves-"));
  try {
    for (const name of [
      "ULUS12345DATA00",
      "ULUS12345DATA01",
      "ULUS99999DATA00",
      "unrelated",
    ])
      fs.mkdirSync(path.join(root, name));
    assert.deepEqual(findPspSaveDirectories([root], "ULUS12345"), [
      path.join(root, "ULUS12345DATA00"),
      path.join(root, "ULUS12345DATA01"),
    ]);
    assert.deepEqual(findPspSaveDirectories([root], "../"), []);
    assert.deepEqual(buildPspRestorePatterns([root], "ULUS12345"), [
      path.join(root, "ULUS12345*"),
    ]);
    assert.deepEqual(buildPspRestorePatterns([root], ""), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DSi maps exact public/private/banner exports and excludes shared NAND/SD images on every platform", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-dsi-saves-"));
  try {
    for (const name of [
      "Title.public.sav",
      "Title.private.sav",
      "Title.banner.sav",
      "Other.public.sav",
      "dsi_nand.bin",
      "dsi_sd_card.bin",
      "Title.bin",
      "Title.dsi_sd_card.bin",
    ])
      fs.writeFileSync(path.join(root, name), "fixture");
    assert.deepEqual(
      findRalibretroSaveFiles([root], path.join(root, "Title.dsi"))
        .map((file) => path.basename(file))
        .sort(),
      ["Title.banner.sav", "Title.private.sav", "Title.public.sav"]
    );
    const patterns = buildEmulatorRestorePatterns({
      binary: "ralibretro",
      system: "dsi",
      roots: [root],
      romPath: path.join(root, "Title.dsi"),
    });
    assert.ok(patterns.some((pattern) => pattern.endsWith("Title.public.sav")));
    assert.ok(patterns.every((pattern) => !pattern.endsWith(".bin")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
