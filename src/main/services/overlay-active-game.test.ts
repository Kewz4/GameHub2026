import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldActivateOverlayGame } from "./overlay-active-game";

const game = (shop: "steam" | "custom", objectId: string) => ({
  shop,
  objectId,
});

describe("overlay active-game arbitration", () => {
  it("refreshes the currently selected running game", () => {
    const current = game("steam", "10");
    assert.equal(shouldActivateOverlayGame(current, current), true);
  });

  it("does not let an older overlapping game steal the active slot", () => {
    assert.equal(
      shouldActivateOverlayGame(game("steam", "20"), game("steam", "10")),
      false
    );
  });

  it("restores a surviving session after the active game closes", () => {
    assert.equal(shouldActivateOverlayGame(null, game("steam", "10")), true);
  });
});
