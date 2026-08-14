import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCanonicalManualGameIdentity,
  normalizeExplicitSteamAppId,
} from "./custom-game-catalogue-match";

describe("custom game catalogue identity", () => {
  it("canonicalizes a selected Steam match without changing custom ownership", () => {
    assert.deepEqual(getCanonicalManualGameIdentity("uuid", "2651280"), {
      shop: "steam",
      objectId: "2651280",
      libraryOrigin: "custom",
    });
  });

  it("keeps unmatched games under their custom identity", () => {
    assert.deepEqual(getCanonicalManualGameIdentity("uuid", null), {
      shop: "custom",
      objectId: "uuid",
      libraryOrigin: "custom",
    });
  });

  it("normalizes valid app IDs and rejects malformed or oversized values", () => {
    assert.equal(normalizeExplicitSteamAppId(" 002651280 "), "2651280");
    assert.equal(normalizeExplicitSteamAppId(null), null);
    assert.throws(() => normalizeExplicitSteamAppId("steam:2651280"));
    assert.throws(() => normalizeExplicitSteamAppId("4294967296"));
  });
});
