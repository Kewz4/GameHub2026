import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCurrentSteamMatchSearch,
  STEAM_MATCH_SEARCH_DEBOUNCE_MS,
  STEAM_MATCH_SEARCH_LIMIT,
  STEAM_MATCH_SEARCH_MIN_QUERY_LENGTH,
} from "./use-steam-match-search";

describe("Steam match search policy", () => {
  it("accepts only the active enabled request and exact query", () => {
    assert.equal(
      isCurrentSteamMatchSearch(3, 3, "Khazan", "Khazan", true),
      true
    );
    assert.equal(
      isCurrentSteamMatchSearch(2, 3, "Khazan", "Khazan", true),
      false
    );
    assert.equal(
      isCurrentSteamMatchSearch(3, 3, "Khazan", "Khazan 2", true),
      false
    );
    assert.equal(
      isCurrentSteamMatchSearch(3, 3, "Khazan", "Khazan", false),
      false
    );
  });

  it("keeps the documented request bounds centralized", () => {
    assert.equal(STEAM_MATCH_SEARCH_MIN_QUERY_LENGTH, 2);
    assert.equal(STEAM_MATCH_SEARCH_LIMIT, 5);
    assert.equal(STEAM_MATCH_SEARCH_DEBOUNCE_MS, 350);
  });
});
