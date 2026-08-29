import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CatalogueEdge } from "./use-recommended-rows";
import { selectCatalogueEdgeForGame } from "./use-recommended-rows";

const edge = (
  title: string,
  objectId: string,
  genres: string[]
): CatalogueEdge =>
  ({
    id: objectId,
    title,
    objectId,
    shop: "steam",
    genres,
    releaseYear: null,
    libraryImageUrl: null,
    downloadSources: [],
  }) as CatalogueEdge;

describe("Big Picture recommendation identity matching", () => {
  const breathOfTheWild = {
    shop: "launchbox",
    objectId: "local-wiiu-botw",
    title: "The Legend of Zelda: Breath of the Wild",
  };

  it("never borrows genres from the first fuzzy catalogue result", () => {
    const hunting = edge("theHunter: Call of the Wild", "518790", [
      "Survival",
      "Hunting",
    ]);

    assert.equal(selectCatalogueEdgeForGame(breathOfTheWild, [hunting]), null);
  });

  it("accepts an exact normalized title even when it is not first", () => {
    const hunting = edge("theHunter: Call of the Wild", "518790", ["Survival"]);
    const zelda = edge(
      "The Legend of Zelda - Breath of the Wild",
      "botw-reference",
      ["Action", "Adventure"]
    );

    assert.equal(
      selectCatalogueEdgeForGame(breathOfTheWild, [hunting, zelda]),
      zelda
    );
  });

  it("prefers an exact shop/object identity over a title collision", () => {
    const titleCollision = edge("Shared title", "other", ["Puzzle"]);
    const identity = edge("Localized title", "42", ["RPG"]);

    assert.equal(
      selectCatalogueEdgeForGame(
        { shop: "steam", objectId: "42", title: "Shared title" },
        [titleCollision, identity]
      ),
      identity
    );
  });
});
