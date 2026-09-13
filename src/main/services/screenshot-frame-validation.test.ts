import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getBitmapColorRange,
  isNearlyUniformScreenshot,
} from "./screenshot-frame-validation";

describe("souvenir screenshot frame validation", () => {
  it("rejects uniform compositor frames but accepts gameplay variation", () => {
    const uniform = new Uint8Array([4, 4, 4, 255, 6, 6, 6, 255]);
    assert.equal(isNearlyUniformScreenshot(getBitmapColorRange(uniform)), true);

    const varied = new Uint8Array([0, 0, 0, 255, 80, 140, 220, 255]);
    assert.equal(isNearlyUniformScreenshot(getBitmapColorRange(varied)), false);
  });
});
