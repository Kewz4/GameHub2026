import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getOverlayUnavailableMessage } from "./overlay-unavailable";

describe("overlay window-mode refusal copy", () => {
  it("explicitly tells exclusive-fullscreen users to switch modes", () => {
    assert.equal(
      getOverlayUnavailableMessage(
        "?kind=overlay-unavailable&reason=exclusive-fullscreen"
      ),
      "Exclusive fullscreen is not supported. Switch the game to Borderless or Windowed."
    );
  });

  it("does not treat legacy input-gate URLs as a current refusal", () => {
    assert.equal(
      getOverlayUnavailableMessage("?kind=input-gate-error&reason=unsupported"),
      null
    );
  });
});
