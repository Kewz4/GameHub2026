import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldHandleOverlayEscape } from "./overlay-dismissal";

describe("Big Picture overlay dismissal", () => {
  it("lets an unhandled Escape dismiss the active overlay", () => {
    assert.equal(
      shouldHandleOverlayEscape({ key: "Escape", defaultPrevented: false }),
      true
    );
  });

  it("does not dismiss twice after the controller navigation layer handles Escape", () => {
    assert.equal(
      shouldHandleOverlayEscape({ key: "Escape", defaultPrevented: true }),
      false
    );
  });
});
