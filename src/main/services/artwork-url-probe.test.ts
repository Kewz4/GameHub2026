import assert from "node:assert/strict";
import test from "node:test";

import { chooseArtworkCandidate } from "./artwork-url-probe";

test("prefers a verified reachable fallback over a broken primary URL", () => {
  assert.equal(
    chooseArtworkCandidate(
      ["https://broken/cover.jpg", "https://good/cover.jpg"],
      ["missing", "reachable"]
    ),
    "https://good/cover.jpg"
  );
});

test("keeps an unknown URL while offline instead of treating it as deleted", () => {
  assert.equal(
    chooseArtworkCandidate(
      ["https://unknown/cover.jpg", "https://missing/cover.jpg"],
      ["unknown", "missing"]
    ),
    "https://unknown/cover.jpg"
  );
});

test("returns null when every candidate is confirmed missing", () => {
  assert.equal(
    chooseArtworkCandidate(
      ["https://one", "https://two"],
      ["missing", "missing"]
    ),
    null
  );
});
