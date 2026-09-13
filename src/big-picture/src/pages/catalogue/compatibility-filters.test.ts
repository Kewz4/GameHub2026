import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DECK_FILTER_OPTIONS,
  PROTON_FILTER_OPTIONS,
  hasCatalogueCompatibilityFilters,
  matchingCompatibilityOption,
  readCatalogueCompatibilityFilters,
} from "./compatibility-filters";

test("Big Picture preserves Desktop Proton and Steam Deck filters in its URL", () => {
  const filters = readCatalogueCompatibilityFilters(
    new URLSearchParams({
      protondbSupportBadges: JSON.stringify(["gold", "platinum"]),
      deckCompatibility: JSON.stringify(["playable", "verified"]),
    })
  );
  assert.deepEqual(filters, {
    protondbSupportBadges: ["gold", "platinum"],
    deckCompatibility: ["playable", "verified"],
  });
  assert.equal(hasCatalogueCompatibilityFilters(filters), true);
});

test("malformed, non-array, unknown and duplicate compatibility values are sanitized", () => {
  assert.deepEqual(
    readCatalogueCompatibilityFilters(
      new URLSearchParams({
        protondbSupportBadges: "{bad json",
        deckCompatibility: '"verified"',
      })
    ),
    { protondbSupportBadges: [], deckCompatibility: [] }
  );
  assert.deepEqual(
    readCatalogueCompatibilityFilters(
      new URLSearchParams({
        protondbSupportBadges: '["platinum",true,"platinum","native",null]',
        deckCompatibility: '["verified",42,"unsafe"]',
      })
    ),
    { protondbSupportBadges: ["platinum"], deckCompatibility: ["verified"] }
  );
});

test("all threshold options round trip and unmatched selections remain explicitly custom", () => {
  const options = PROTON_FILTER_OPTIONS.map((option) => ({
    value: option.value,
    values: option.badges,
  }));
  for (const option of options)
    assert.equal(
      matchingCompatibilityOption([...option.values].reverse(), options),
      option.value
    );
  assert.equal(matchingCompatibilityOption(["bronze"], options), "custom");
  const deckOptions = DECK_FILTER_OPTIONS.map((option) => ({
    value: option.value,
    values: option.ratings,
  }));
  for (const option of deckOptions)
    assert.equal(
      matchingCompatibilityOption(option.values, deckOptions),
      option.value
    );
});

test("either compatibility filter excludes console classics from a mixed search", () => {
  assert.equal(hasCatalogueCompatibilityFilters({}), false);
  assert.equal(
    hasCatalogueCompatibilityFilters({ protondbSupportBadges: ["silver"] }),
    true
  );
  assert.equal(
    hasCatalogueCompatibilityFilters({ deckCompatibility: ["verified"] }),
    true
  );
});
