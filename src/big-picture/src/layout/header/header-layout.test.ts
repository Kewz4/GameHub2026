import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_BIG_PICTURE_HEADER_FOOTPRINT,
  resolveBigPictureHeaderFootprint,
} from "./header-layout";

describe("Big Picture header footprint", () => {
  it("never lets content overlap the base header height", () => {
    assert.equal(
      resolveBigPictureHeaderFootprint(40),
      MIN_BIG_PICTURE_HEADER_FOOTPRINT
    );
  });

  it("tracks a taller profile card and rounds fractional layout pixels up", () => {
    assert.equal(resolveBigPictureHeaderFootprint(64.2), 65);
  });

  it("uses the safe minimum before the header can be measured", () => {
    assert.equal(
      resolveBigPictureHeaderFootprint(Number.NaN),
      MIN_BIG_PICTURE_HEADER_FOOTPRINT
    );
  });
});
