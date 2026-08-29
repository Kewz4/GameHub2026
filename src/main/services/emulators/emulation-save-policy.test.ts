import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertEmulationSavePlatform,
  emulatorForEmulationSavePlatform,
  isEmulationSaveKeyForPlatform,
  isMemoryCardPathForPlatform,
  sanitizeEmulationSaveExportStem,
} from "./emulation-save-policy";

describe("dedicated emulation-save policy", () => {
  it("keeps PS1 and PS2 platform/emulator identities canonical", () => {
    assert.equal(emulatorForEmulationSavePlatform("ps1"), "duckstation");
    assert.equal(emulatorForEmulationSavePlatform("ps2"), "pcsx2");
    assert.doesNotThrow(() => assertEmulationSavePlatform("ps1"));
    assert.throws(
      () => assertEmulationSavePlatform("../../other"),
      /Invalid emulation save platform/
    );
  });

  it("accepts every picker extension only for the requested platform", () => {
    for (const extension of ["mcd", "mcr", "mc", "gme", "vgs", "vmp"]) {
      assert.equal(
        isMemoryCardPathForPlatform("ps1", `C:\\cards\\card.${extension}`),
        true,
        extension
      );
    }
    for (const extension of ["ps2", "mcd", "mc2"]) {
      assert.equal(
        isMemoryCardPathForPlatform("ps2", `C:\\cards\\card.${extension}`),
        true,
        extension
      );
    }
    assert.equal(isMemoryCardPathForPlatform("ps1", "card.ps2"), false);
    assert.equal(isMemoryCardPathForPlatform("ps2", "card.mcr"), false);
  });

  it("binds restore requests to the platform segment and sanitizes sidecars", () => {
    const key =
      "users/account/emulation-saves/ps1/BASLUS-1/1720000000000-save.mcs";
    assert.equal(isEmulationSaveKeyForPlatform(key, "ps1"), true);
    assert.equal(isEmulationSaveKeyForPlatform(key, "ps2"), false);
    assert.equal(
      sanitizeEmulationSaveExportStem("../../bad\\name"),
      "_.._bad_name"
    );
  });
});
