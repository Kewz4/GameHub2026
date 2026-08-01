import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildEmulatorRestorePatterns,
  findRalibretroSaveFiles,
  findRpcs3ProfileSaveRoots,
  fingerprintSavePaths,
  pathContainsFile,
  resolveStoredGameRomPath,
} from "../../src/main/services/emulators/emulator-save-paths.ts";
import { isSaveRestoreDestinationAllowed } from "../../src/main/events/cloud-save/restore-path-safety.ts";

const withTempDir = async (run: (dir: string) => void | Promise<void>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-save-paths-"));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("resolves selected ROM, then an existing disc, then executable", async () => {
  await withTempDir((dir) => {
    const selected = path.join(dir, "selected.gba");
    const disc = path.join(dir, "disc.gba");
    const executable = path.join(dir, "fallback.gba");
    fs.writeFileSync(disc, "disc");
    fs.writeFileSync(executable, "fallback");

    const game = {
      selectedDiscPath: selected,
      discs: [{ path: path.join(dir, "missing.gba") }, { path: disc }],
      executablePath: executable,
    };
    assert.equal(resolveStoredGameRomPath(game), disc);

    fs.writeFileSync(selected, "selected");
    assert.equal(resolveStoredGameRomPath(game), selected);
    assert.equal(
      resolveStoredGameRomPath({ executablePath: executable }),
      executable
    );
  });
});

test("isolates RALibretro saves by full ROM filename", async () => {
  await withTempDir((dir) => {
    const saves = path.join(dir, "Saves");
    const nested = path.join(saves, "mGBA");
    fs.mkdirSync(nested, { recursive: true });
    const rom = path.join(dir, "The Game.gba");
    fs.writeFileSync(rom, "rom");

    const exactSram = path.join(saves, "The Game.gba.sram");
    const exactRtc = path.join(nested, "The Game.gba.rtc");
    fs.writeFileSync(exactSram, "save");
    fs.writeFileSync(exactRtc, "clock");
    fs.writeFileSync(path.join(saves, "The Game.srm"), "ambiguous stem");
    fs.writeFileSync(path.join(saves, "Another Game.gba.sram"), "other");

    assert.deepEqual(
      findRalibretroSaveFiles([saves], rom).sort(),
      [exactSram, exactRtc].sort()
    );
    assert.deepEqual(
      findRalibretroSaveFiles([saves], path.join(dir, "Missing.gba")),
      []
    );
  });
});

test("uses the stem form only when no full-ROM-name save exists", async () => {
  await withTempDir((dir) => {
    const saves = path.join(dir, "Saves");
    fs.mkdirSync(saves);
    const fallback = path.join(saves, "Legacy Name.srm");
    fs.writeFileSync(fallback, "save");

    assert.deepEqual(
      findRalibretroSaveFiles([saves], path.join(dir, "Legacy Name.gbc")),
      [fallback]
    );
  });
});

test("enumerates every RPCS3 profile with an existing savedata root", async () => {
  await withTempDir((dir) => {
    const first = path.join(dir, "dev_hdd0", "home", "00000001", "savedata");
    const second = path.join(dir, "dev_hdd0", "home", "00000002", "savedata");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    fs.mkdirSync(path.join(dir, "dev_hdd0", "home", "00000003"));

    assert.deepEqual(findRpcs3ProfileSaveRoots(dir), [first, second]);
  });
});

test("detects payloads and fingerprints direct files without duplicates", async () => {
  await withTempDir((dir) => {
    const empty = path.join(dir, "empty");
    const payloadDir = path.join(dir, "payload");
    const payload = path.join(payloadDir, "save.dat");
    fs.mkdirSync(empty);
    fs.mkdirSync(payloadDir);
    fs.writeFileSync(payload, "save");

    assert.equal(pathContainsFile(empty), false);
    assert.equal(pathContainsFile(payloadDir), true);
    assert.equal(pathContainsFile(payload), true);

    const fingerprint = fingerprintSavePaths([payloadDir, payload]);
    assert.match(fingerprint, /^1:4:\d+$/);
  });
});

test("builds a prospective per-ROM RALibretro restore rule on a clean install", async () => {
  await withTempDir((dir) => {
    const saveRoot = path.join(dir, "Saves");
    const romPath = path.join(dir, "Pokemon Red.gb");
    const patterns = buildEmulatorRestorePatterns({
      system: "gb",
      binary: "ralibretro",
      roots: [saveRoot],
      romPath,
    });

    assert.equal(
      isSaveRestoreDestinationAllowed(
        path.join(saveRoot, "SameBoy", "Pokemon Red.gb.sram"),
        patterns
      ),
      true
    );
    assert.equal(
      isSaveRestoreDestinationAllowed(
        path.join(saveRoot, "Pokemon Red.gb.sram"),
        patterns
      ),
      true
    );
    assert.equal(
      isSaveRestoreDestinationAllowed(
        path.join(saveRoot, "SameBoy", "Pokemon Blue.gb.sram"),
        patterns
      ),
      false
    );
  });
});

test("uses exact current Switch profiles and leaves ambiguity for the planner", async () => {
  await withTempDir((dir) => {
    const root = path.join(dir, "nand", "user", "save");
    const account = path.join(root, "0000000000000000");
    const first = path.join(account, "A".repeat(32));
    const second = path.join(account, "B".repeat(32));
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });

    const titleId = "01002b00111a2000";
    assert.deepEqual(
      buildEmulatorRestorePatterns({
        system: "switch",
        binary: "eden",
        roots: [root],
        identity: titleId,
      }),
      [path.join(first, titleId), path.join(second, titleId)]
    );
  });
});

test("preserves an artifact Switch profile only when the clean install has none", async () => {
  await withTempDir((dir) => {
    const root = path.join(dir, "nand", "user", "save");
    const titleId = "01002b00111a2000";
    const patterns = buildEmulatorRestorePatterns({
      system: "switch",
      binary: "eden",
      roots: [root],
      identity: titleId,
    });
    assert.equal(
      isSaveRestoreDestinationAllowed(
        path.join(
          root,
          "0000000000000000",
          "A".repeat(32),
          titleId,
          "save.dat"
        ),
        patterns
      ),
      true
    );
  });
});

test("builds prospective 3DS, Wii, and RPCS3 identity mappings", async () => {
  await withTempDir((dir) => {
    const threeDsRoot = path.join(dir, "sdmc");
    const threeDs = buildEmulatorRestorePatterns({
      system: "n3ds",
      binary: "azahar",
      roots: [threeDsRoot],
      identity: "0004000000033600",
    });
    assert.equal(
      isSaveRestoreDestinationAllowed(
        path.join(
          threeDsRoot,
          "Nintendo 3DS",
          "0".repeat(32),
          "0".repeat(32),
          "title",
          "00040000",
          "00033600",
          "data",
          "save.dat"
        ),
        threeDs
      ),
      true
    );

    assert.deepEqual(
      buildEmulatorRestorePatterns({
        system: "wii",
        binary: "dolphin",
        roots: [path.join(dir, "Wii")],
        identity: "524d4345",
      }),
      [path.join(dir, "Wii", "title", "00010000", "524d4345")]
    );

    const ps3Root = path.join(dir, "dev_hdd0", "home", "00000001", "savedata");
    const ps3 = buildEmulatorRestorePatterns({
      system: "ps3",
      binary: "rpcs3",
      roots: [ps3Root],
      identity: "BLES12345",
    });
    assert.equal(
      isSaveRestoreDestinationAllowed(
        path.join(ps3Root, "BLES12345-PROFILE", "PARAM.SFO"),
        ps3
      ),
      true
    );
  });
});

test("derives a clean Wii U title destination without creating it", async () => {
  await withTempDir((dir) => {
    const titleId = "00050000101c9500";
    const expected = path.join(dir, "00050000", "101c9500", "user");
    assert.deepEqual(
      buildEmulatorRestorePatterns({
        system: "wiiu",
        binary: "cemu",
        roots: [dir],
        identity: titleId,
      }),
      [expected]
    );
    assert.equal(fs.existsSync(expected), false);
  });
});
