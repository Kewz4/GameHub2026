import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getTabRevealScrollLeft } from "./tab-scroll";

describe("compact Big Picture tab rail", () => {
  it("does not move an already visible selected tab", () => {
    assert.equal(
      getTabRevealScrollLeft({
        currentScrollLeft: 200,
        viewportWidth: 640,
        scrollWidth: 1200,
        itemOffsetLeft: 360,
        itemWidth: 120,
      }),
      200
    );
  });

  it("reveals a selected tab clipped at the right edge", () => {
    assert.equal(
      getTabRevealScrollLeft({
        currentScrollLeft: 0,
        viewportWidth: 640,
        scrollWidth: 1200,
        itemOffsetLeft: 620,
        itemWidth: 130,
      }),
      134
    );
  });

  it("reveals a selected tab clipped at the left edge", () => {
    assert.equal(
      getTabRevealScrollLeft({
        currentScrollLeft: 420,
        viewportWidth: 640,
        scrollWidth: 1200,
        itemOffsetLeft: 300,
        itemWidth: 100,
      }),
      276
    );
  });

  it("clamps the final category to the rail's maximum scroll", () => {
    assert.equal(
      getTabRevealScrollLeft({
        currentScrollLeft: 0,
        viewportWidth: 640,
        scrollWidth: 1000,
        itemOffsetLeft: 940,
        itemWidth: 100,
      }),
      360
    );
  });
});
