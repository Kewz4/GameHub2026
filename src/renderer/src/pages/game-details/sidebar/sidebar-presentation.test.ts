import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasRenderableRequirements,
  shouldRenderHowLongToBeat,
} from "./sidebar-presentation";

describe("desktop game-details sidebar presentation", () => {
  it("hides requirement controls when both requirement bodies are blank", () => {
    assert.equal(
      hasRenderableRequirements({ minimum: "", recommended: "   " }),
      false
    );
    assert.equal(
      hasRenderableRequirements({
        minimum: "<ul><li>&nbsp;</li></ul>",
        recommended: "<br />",
      }),
      false
    );
  });

  it("keeps the requirements section when either body has real content", () => {
    assert.equal(
      hasRenderableRequirements({
        minimum: "",
        recommended: "<strong>GPU:</strong> GTX 1060",
      }),
      true
    );
  });

  it("renders HowLongToBeat only while loading or with categories", () => {
    assert.equal(shouldRenderHowLongToBeat(null, true), true);
    assert.equal(shouldRenderHowLongToBeat(null, false), false);
    assert.equal(shouldRenderHowLongToBeat([], false), false);
    assert.equal(
      shouldRenderHowLongToBeat(
        [{ title: "Main Story", duration: "12 Hours", accuracy: "90" }],
        false
      ),
      true
    );
  });
});
