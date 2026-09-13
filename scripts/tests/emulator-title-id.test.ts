import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeSwitchTitleId,
  read3dsTitleId,
  resolveConsoleSaveNeedle,
  searchAzaharSaveTreeForTitleId,
} from "../../src/main/services/emulators/emulator-title-id.ts";

const withTempDir = async (run: (dir: string) => void | Promise<void>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-title-id-"));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const writeLittleEndianId = (
  buffer: Buffer,
  offset: number,
  titleId: string
) => {
  Buffer.from(titleId, "hex").reverse().copy(buffer, offset);
};

test("normalizes Switch base, update, and AOC title ids", () => {
  assert.equal(normalizeSwitchTitleId("01008CF01BAAC000"), "01008cf01baac000");
  assert.equal(normalizeSwitchTitleId("01008CF01BAAC800"), "01008cf01baac000");
  assert.equal(normalizeSwitchTitleId("01007EF00011F001"), "01007ef00011e000");
  assert.equal(normalizeSwitchTitleId("0100000000010C00"), "0100000000010000");
});

test("reads a 3DS title id from NCSD and NCCH headers", async () => {
  await withTempDir((dir) => {
    const ncsd = Buffer.alloc(0x600);
    ncsd.write("NCSD", 0x100, "ascii");
    // Deliberately make the NCSD media id different: the parser must follow
    // the partition table and read the authoritative NCCH program id.
    writeLittleEndianId(ncsd, 0x108, "00040000deadbeef");
    ncsd.writeUInt32LE(2, 0x120); // partition starts at 2 * 0x200 = 0x400
    ncsd.write("NCCH", 0x500, "ascii");
    writeLittleEndianId(ncsd, 0x518, "0004000000033600");
    const ncsdPath = path.join(dir, "Ocarina of Time 3D.3ds");
    fs.writeFileSync(ncsdPath, ncsd);

    const ncch = Buffer.alloc(0x200);
    ncch.write("NCCH", 0x100, "ascii");
    writeLittleEndianId(ncch, 0x118, "0004000000123400");
    const ncchPath = path.join(dir, "game.cxi");
    fs.writeFileSync(ncchPath, ncch);

    assert.equal(read3dsTitleId(ncsdPath), "0004000000033600");
    assert.equal(read3dsTitleId(ncchPath), "0004000000123400");
    assert.equal(
      resolveConsoleSaveNeedle("n3ds", ncsdPath),
      "0004000000033600"
    );
  });
});

test("matches Azahar's split high/low title-id directory", async () => {
  await withTempDir((dir) => {
    const titleRoot = path.join(
      dir,
      "Nintendo 3DS",
      "profile",
      "title",
      "00040000",
      "00033600"
    );
    fs.mkdirSync(path.join(titleRoot, "data", "00000001"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(titleRoot, "data", "save.dat"), "save");

    assert.deepEqual(
      searchAzaharSaveTreeForTitleId([dir], "0004000000033600"),
      [titleRoot]
    );
    assert.deepEqual(
      searchAzaharSaveTreeForTitleId([dir], "0004000000999900"),
      []
    );
  });
});

test("normalizes a Switch update id resolved from the ROM filename", async () => {
  await withTempDir((dir) => {
    const rom = path.join(
      dir,
      "Echoes of Wisdom [01008CF01BAAC800][v196608].nsp"
    );
    fs.writeFileSync(rom, "not-an-nsp");
    assert.equal(resolveConsoleSaveNeedle("switch", rom), "01008cf01baac000");
  });
});
