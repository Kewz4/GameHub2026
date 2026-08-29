import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fitScreenshotTo1080p } from "./screenshot-size";

describe("souvenir screenshot size", () => {
  it("preserves captures at or below 1080p", () => {
    assert.deepEqual(fitScreenshotTo1080p({ width: 1_920, height: 1_080 }), {
      width: 1_920,
      height: 1_080,
    });
  });

  it("downscales HDR-sized frames without changing aspect ratio", () => {
    assert.deepEqual(fitScreenshotTo1080p({ width: 3_840, height: 2_160 }), {
      width: 1_920,
      height: 1_080,
    });
  });
});
