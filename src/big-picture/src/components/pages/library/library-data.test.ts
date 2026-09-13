import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LibraryGame } from "@types";

import {
  filterLibraryBySecondaryFilter,
  getLibraryConsoleFilter,
  getLibraryConsoleSystem,
  isLibrarySecondaryFilter,
} from "./library-data";

const game = (
  overrides: Partial<LibraryGame> & Pick<LibraryGame, "objectId" | "shop">
) =>
  ({
    id: `${overrides.shop}:${overrides.objectId}`,
    title: overrides.objectId,
    favorite: false,
    ...overrides,
  }) as LibraryGame;

describe("Big Picture library console filters", () => {
  it("persists both the console parent and known nested systems", () => {
    assert.equal(isLibrarySecondaryFilter("console"), true);
    assert.equal(isLibrarySecondaryFilter("console:n3ds"), true);
    assert.equal(isLibrarySecondaryFilter("console:switch"), true);
    assert.equal(isLibrarySecondaryFilter("console:dreamcast"), false);
    assert.equal(getLibraryConsoleSystem("console:ps2"), "ps2");
    assert.equal(getLibraryConsoleSystem("steam"), null);
  });

  it("groups every emulated game under Console and its exact system", () => {
    const n3ds = game({ shop: "launchbox", objectId: "local-n3ds-a" });
    const switchGame = game({
      shop: "launchbox",
      objectId: "minerva:switch:example",
    });
    const steam = game({ shop: "steam", objectId: "10" });
    const library = [n3ds, switchGame, steam];

    assert.deepEqual(
      filterLibraryBySecondaryFilter(library, "console").map(
        (entry) => entry.objectId
      ),
      [n3ds.objectId, switchGame.objectId]
    );
    assert.deepEqual(
      filterLibraryBySecondaryFilter(
        library,
        getLibraryConsoleFilter("n3ds")
      ).map((entry) => entry.objectId),
      [n3ds.objectId]
    );
  });

  it("uses a bound Game Boy ROM extension as the nested filter truth", () => {
    const gameBoy = game({
      shop: "launchbox",
      objectId: "minerva:gba:tetris",
      selectedDiscPath: "C:\\roms\\Tetris.gb",
    });

    assert.deepEqual(
      filterLibraryBySecondaryFilter([gameBoy], getLibraryConsoleFilter("gb")),
      [gameBoy]
    );
    assert.deepEqual(
      filterLibraryBySecondaryFilter([gameBoy], getLibraryConsoleFilter("gba")),
      []
    );
  });

  it("keeps emulator entries out of the manually-added PC filter", () => {
    const emulator = game({
      shop: "launchbox",
      objectId: "local-n3ds-custom",
      libraryOrigin: "custom",
    });
    const custom = game({
      shop: "custom",
      objectId: "custom-game",
      libraryOrigin: "custom",
    });

    assert.deepEqual(
      filterLibraryBySecondaryFilter([emulator, custom], "custom"),
      [custom]
    );
  });
});
