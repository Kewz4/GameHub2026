import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game, GameShop } from "@types";

import {
  createGameSaveFolderResolver,
  resolveManualSaveFolder,
  toGameSaveFolderCandidate,
} from "./game-save-folder";

const withTempDir = async (
  run: (directory: string) => void | Promise<void>
) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gamehub-save-dir-"));
  try {
    await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const game = (overrides: Partial<Game> = {}): Game => ({
  title: "Test game",
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  playTimeInMilliseconds: 0,
  lastTimePlayed: null,
  objectId: "game",
  shop: "custom",
  remoteId: null,
  isDeleted: false,
  ...overrides,
});

describe("game save folder resolver", () => {
  it("uses an authoritative manual directory or file before every fallback", async () => {
    await withTempDir(async (directory) => {
      const manualDirectory = path.join(directory, "manual");
      const manualFile = path.join(directory, "mapped", "save.dat");
      fs.mkdirSync(manualDirectory);
      fs.mkdirSync(path.dirname(manualFile));
      fs.writeFileSync(manualFile, "save");

      assert.equal(
        resolveManualSaveFolder({ files: [manualDirectory] }),
        manualDirectory
      );
      assert.equal(
        resolveManualSaveFolder({ files: [manualFile] }),
        path.dirname(manualFile)
      );

      let emulatorLookups = 0;
      let manifestLookups = 0;
      const resolve = createGameSaveFolderResolver({
        getManualSaveMapping: async () => ({ files: [manualDirectory] }),
        resolveEmulatorGameSaveFolder: async () => {
          emulatorLookups += 1;
          return path.join(directory, "emulator");
        },
        getGame: async () => game(),
        getGameTitleFallback: async () => null,
        findManifestSavePaths: async () => {
          manifestLookups += 1;
          return [path.join(directory, "manifest")];
        },
      });

      assert.equal(await resolve("custom", "game"), manualDirectory);
      assert.equal(emulatorLookups, 0);
      assert.equal(manifestLookups, 0);
    });
  });

  it("does not widen a missing authoritative manual mapping", async () => {
    await withTempDir(async (directory) => {
      let fallbackLookups = 0;
      const resolve = createGameSaveFolderResolver({
        getManualSaveMapping: async () => ({
          files: [path.join(directory, "missing")],
        }),
        resolveEmulatorGameSaveFolder: async () => {
          fallbackLookups += 1;
          return directory;
        },
        getGame: async () => game(),
        getGameTitleFallback: async () => null,
        findManifestSavePaths: async () => {
          fallbackLookups += 1;
          return [directory];
        },
      });

      assert.equal(await resolve("custom", "game"), null);
      assert.equal(fallbackLookups, 0);
    });
  });

  it("opens emulator locations before a PC manifest lookup", async () => {
    await withTempDir(async (directory) => {
      let manifestLookups = 0;
      const resolve = createGameSaveFolderResolver({
        getManualSaveMapping: async () => null,
        resolveEmulatorGameSaveFolder: async () => directory,
        getGame: async () => game({ shop: "launchbox" }),
        getGameTitleFallback: async () => null,
        findManifestSavePaths: async () => {
          manifestLookups += 1;
          return [];
        },
      });

      assert.equal(await resolve("launchbox", "game"), directory);
      assert.equal(manifestLookups, 0);
    });
  });

  it("resolves every PC/custom shop through the V2 manifest path", async () => {
    await withTempDir(async (directory) => {
      const installDir = path.join(directory, "install");
      const externalSaveDir = path.join(directory, "profiles", "save");
      fs.mkdirSync(installDir, { recursive: true });
      fs.mkdirSync(externalSaveDir, { recursive: true });
      const executable = path.join(installDir, "game.exe");
      fs.writeFileSync(executable, "exe");

      for (const shop of [
        "steam",
        "epic",
        "gog",
        "battlenet",
        "xbox",
        "riot",
        "ubisoft",
        "ea",
        "custom",
      ] as GameShop[]) {
        let observedExecutable: string | null = null;
        const resolve = createGameSaveFolderResolver({
          getManualSaveMapping: async () => null,
          resolveEmulatorGameSaveFolder: async () => null,
          getGame: async () => game({ shop, executablePath: executable }),
          getGameTitleFallback: async () => null,
          findManifestSavePaths: async (
            _shop,
            _title,
            _objectId,
            executablePath
          ) => {
            observedExecutable = executablePath;
            return [
              path.join(installDir, "save.dat"),
              path.join(externalSaveDir, "profile.sav"),
            ];
          },
        });

        assert.equal(await resolve(shop, "game"), externalSaveDir, shop);
        assert.equal(observedExecutable, executable, shop);
      }
    });
  });

  it("keeps a store protocol identity eligible for manifest save discovery", async () => {
    await withTempDir(async (directory) => {
      const saveDir = path.join(directory, "save");
      fs.mkdirSync(saveDir);
      const protocol = "steam://run/123";
      let observedExecutable: string | null = null;
      const resolve = createGameSaveFolderResolver({
        getManualSaveMapping: async () => null,
        resolveEmulatorGameSaveFolder: async () => null,
        getGame: async () => game({ shop: "steam", executablePath: protocol }),
        getGameTitleFallback: async () => null,
        findManifestSavePaths: async (
          _shop,
          _title,
          _objectId,
          executablePath
        ) => {
          observedExecutable = executablePath;
          return [path.join(saveDir, "profile.sav")];
        },
      });

      assert.equal(await resolve("steam", "game"), saveDir);
      assert.equal(observedExecutable, protocol);
    });
  });

  it("cuts globs at the containing directory", async () => {
    await withTempDir(async (directory) => {
      const profile = path.join(directory, "profile");
      fs.mkdirSync(profile);
      const mappedGlob = path.join(profile, "**", "*.sav");
      assert.equal(toGameSaveFolderCandidate(mappedGlob), profile);
      assert.equal(resolveManualSaveFolder({ files: [mappedGlob] }), profile);
    });
  });
});
