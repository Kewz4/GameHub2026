import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { resolveGameFolderTarget } from "./game-folder-target";

const game = (overrides: Partial<Game> = {}): Game => ({
  title: "Test",
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

const existing = (...paths: string[]) => {
  const known = new Set(paths);
  return (candidate: string | null | undefined) =>
    Boolean(candidate && known.has(candidate));
};

describe("open game folder target", () => {
  it("selects a native PC executable", () => {
    const target = "C:\\Games\\Example\\game.exe";
    assert.equal(
      resolveGameFolderTarget(
        game({ executablePath: target }),
        existing(target)
      ),
      target
    );
  });

  it("uses a discovered native executable behind a store protocol", () => {
    const target = "C:\\Games\\Steam\\game.exe";
    assert.equal(
      resolveGameFolderTarget(
        game({
          shop: "steam",
          executablePath: "steam://run/123",
          nativeExecutablePath: target,
        }),
        existing(target)
      ),
      target
    );
  });

  it("does not pass a protocol URI to the filesystem shell", () => {
    assert.equal(
      resolveGameFolderTarget(
        game({ shop: "gog", executablePath: "goggalaxy://openGame/123" }),
        () => true
      ),
      null
    );
  });

  it("prefers the selected emulator disc and falls back to another real disc", () => {
    const selected = "D:\\ROMs\\selected.rvz";
    const fallback = "D:\\ROMs\\fallback.rvz";
    const emulated = game({
      shop: "launchbox",
      selectedDiscPath: selected,
      discs: [{ path: fallback, label: "Disc 1", fileName: "fallback.rvz" }],
      executablePath: null,
    });

    assert.equal(
      resolveGameFolderTarget(emulated, existing(selected, fallback)),
      selected
    );
    assert.equal(
      resolveGameFolderTarget(emulated, existing(fallback)),
      fallback
    );
  });

  it("accepts a folder-format ROM target", () => {
    const folder = "D:\\ROMs\\PS3_GAME";
    assert.equal(
      resolveGameFolderTarget(
        game({ shop: "launchbox", selectedDiscPath: folder }),
        existing(folder)
      ),
      folder
    );
  });
});
