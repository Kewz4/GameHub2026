import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DetectedRom } from "@types";
import {
  BIG_PICTURE_EMULATOR_ROMS_PAGE_SIZE,
  getBigPictureEmulatorRomsPage,
} from "./emulator-roms-presentation";

const rom = (index: number): DetectedRom => ({
  objectId: String(index),
  title: index === 9 ? "Twilight Princess HD" : `Game ${index}`,
  libraryImageUrl: null,
  iconUrl: null,
  sizeBytes: index,
  skus: index === 9 ? ["WIIU-1019E600"] : [`SKU-${index}`],
});

describe("Big Picture detected emulator games", () => {
  it("filters titles and SKUs before paginating", () => {
    const roms = Array.from({ length: 18 }, (_, index) => rom(index));

    assert.equal(
      getBigPictureEmulatorRomsPage(roms, "twilight", 0).items[0]?.objectId,
      "9"
    );
    assert.equal(
      getBigPictureEmulatorRomsPage(roms, "1019e600", 0).items[0]?.objectId,
      "9"
    );
    assert.equal(
      getBigPictureEmulatorRomsPage(roms, "", 1).items.length,
      BIG_PICTURE_EMULATOR_ROMS_PAGE_SIZE
    );
  });

  it("clamps a stale page after filtering", () => {
    const page = getBigPictureEmulatorRomsPage([rom(9)], "twilight", 99);
    assert.equal(page.page, 0);
    assert.equal(page.pageCount, 1);
  });
});
