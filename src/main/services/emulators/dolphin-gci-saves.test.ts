import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildDolphinGciRestorePatterns,
  findDolphinGciFilesForGame,
  resolveDolphinGciCardFolders,
} from "./dolphin-gci-saves";

const withTempDir = async (
  run: (directory: string) => void | Promise<void>
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dolphin-gci-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

const writeIni = async (installDir: string, contents: string) => {
  const configDir = path.join(installDir, "User", "Config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "Dolphin.ini"), contents);
};

describe("Dolphin GCI cloud-save isolation", () => {
  it("uses modern Dolphin's default Slot A GCI folder layout", async () => {
    await withTempDir((installDir) => {
      const folders = resolveDolphinGciCardFolders(installDir, "GMSE01");
      assert.deepEqual(
        folders,
        ["USA", "JAP", "EUR", "DEV"].map((region) =>
          path.join(installDir, "User", "GC", region, "Card A")
        )
      );
      assert.deepEqual(
        buildDolphinGciRestorePatterns(folders),
        folders.map((folder) => path.join(folder, "*.gci"))
      );
    });
  });

  it("honors explicit slots and fails closed for raw cards or custom paths", async () => {
    await withTempDir(async (installDir) => {
      await writeIni(
        installDir,
        "[Core]\nSlotA = 1\nSlotB = 8\nGCIFolderBPath = D:/Shared/Card B/USA\n"
      );
      assert.deepEqual(resolveDolphinGciCardFolders(installDir, "GMSE01"), []);

      await writeIni(installDir, "[Core]\nSlotA = 8\nSlotB = 8\n");
      assert.equal(
        resolveDolphinGciCardFolders(installDir, "GMSE01").length,
        8
      );

      const gameSettings = path.join(installDir, "User", "GameSettings");
      await fs.mkdir(gameSettings, { recursive: true });
      await fs.writeFile(
        path.join(gameSettings, "GMSE01.ini"),
        "[Core]\nSlotA = 1\nSlotB = 255\n"
      );
      assert.deepEqual(resolveDolphinGciCardFolders(installDir, "GMSE01"), []);
    });
  });

  it("matches the same four-byte GCI game code Dolphin uses", async () => {
    await withTempDir(async (installDir) => {
      const card = path.join(installDir, "User", "GC", "USA", "Card A");
      await fs.mkdir(path.join(card, "nested"), { recursive: true });
      const matching = path.join(card, "01-GMSE-save.gci");
      const secondMatching = path.join(card, "nested", "02-GMSE-save.gci");
      const sibling = path.join(card, "01-GZLE-save.gci");
      const deleted = path.join(card, "03-GMSE-save.gci.deleted");
      await Promise.all([
        fs.writeFile(matching, Buffer.from("GMSEpayload")),
        fs.writeFile(secondMatching, Buffer.from("GMSEpayload-2")),
        fs.writeFile(sibling, Buffer.from("GZLEpayload")),
        fs.writeFile(deleted, Buffer.from("GMSEdeleted")),
      ]);

      assert.deepEqual(findDolphinGciFilesForGame([card], "GMSE01"), [
        matching,
        secondMatching,
      ]);
      assert.deepEqual(findDolphinGciFilesForGame([card], "GZLE01"), [sibling]);
    });
  });
});
