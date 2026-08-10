import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasHostedConsoleMetadataExtras,
  mergeHostedConsoleMetadataExtras,
  resolveConsoleMetadataCriticScore,
} from "./console-metadata-extras";

describe("hosted console metadata fallbacks", () => {
  it("fills every missing partial-cache field from bundled metadata", () => {
    const result = mergeHostedConsoleMetadataExtras(
      {
        hltb: { main: null, mainExtra: 31.5, completionist: null },
        ageRating: { name: "RP", system: null },
      },
      {
        ratingScore: 95,
        hltb: { main: 25, mainExtra: 34.5, completionist: 38.5 },
        ageRating: { name: "RP", system: "CERO" },
        boxImageUrl: "bundled-box.png",
      }
    );

    assert.deepEqual(result, {
      ratingScore: 95,
      hltb: { main: 25, mainExtra: 31.5, completionist: 38.5 },
      ageRating: { name: "RP", system: "CERO" },
      boxImageUrl: "bundled-box.png",
    });
  });

  it("preserves valid cached zeroes instead of treating them as missing", () => {
    const result = mergeHostedConsoleMetadataExtras(
      { ratingScore: 0 },
      { ratingScore: 95 }
    );

    assert.equal(result.ratingScore, 0);
    assert.equal(hasHostedConsoleMetadataExtras(result), true);
  });

  it("distinguishes a real hosted fallback from an empty dataset entry", () => {
    assert.equal(
      hasHostedConsoleMetadataExtras(
        mergeHostedConsoleMetadataExtras(undefined, undefined)
      ),
      false
    );
    assert.equal(
      hasHostedConsoleMetadataExtras(
        mergeHostedConsoleMetadataExtras(undefined, {
          hltb: { main: 0, mainExtra: null, completionist: null },
        })
      ),
      true
    );
  });

  it("prefers the console-specific score over an IGDB aggregate", () => {
    assert.equal(resolveConsoleMetadataCriticScore(95, 94), 95);
  });

  it("uses IGDB only when hosted metadata has no score", () => {
    assert.equal(resolveConsoleMetadataCriticScore(null, 94), 94);
    assert.equal(resolveConsoleMetadataCriticScore(undefined, null), null);
  });
});
