import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { removeDiacritics } from "./index";

describe("removeDiacritics", () => {
  it("matches composed and decomposed accents", () => {
    assert.equal(removeDiacritics("Pokémon"), "Pokemon");
    assert.equal(removeDiacritics("Poke\u0301mon"), "Pokemon");
  });

  it("normalizes characters without a canonical decomposition", () => {
    assert.equal(removeDiacritics("Æon Flux"), "AEon Flux");
    assert.equal(removeDiacritics("Øresund"), "Oresund");
  });
});
