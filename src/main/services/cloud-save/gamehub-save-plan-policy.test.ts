import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectGameHubSavePlanLookup } from "./gamehub-save-plan-policy";

describe("GameHub V2 save-plan lookup policy", () => {
  it("does not run the legacy Ludusavi plan for a native PC game", () => {
    assert.equal(selectGameHubSavePlanLookup(false, null), null);
  });

  it("keeps explicit manual mappings authoritative", () => {
    assert.equal(selectGameHubSavePlanLookup(true, null), "manual");
  });

  it("keeps the emulator adapter enabled", () => {
    assert.equal(selectGameHubSavePlanLookup(false, "wiiu"), "emulator");
  });
});
