import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CatalogueRecommendationEdge } from "./recommendation-identity";
import {
  selectCatalogueRecommendationEdge,
  selectPcRecommendationGames,
} from "./recommendation-identity";

const edge = (
  title: string,
  objectId: string,
  genres: string[]
): CatalogueRecommendationEdge =>
  ({
    id: objectId,
    title,
    objectId,
    shop: "steam",
    genres,
    releaseYear: null,
    libraryImageUrl: null,
    downloadSources: [],
  }) as CatalogueRecommendationEdge;

describe("shared Home recommendation identity and routing", () => {
  const breathOfTheWild = {
    shop: "launchbox",
    objectId: "local-wiiu-botw",
    title: "The Legend of Zelda: Breath of the Wild",
  };

  it("never borrows survival genres from the first fuzzy catalogue result", () => {
    const hunting = edge("theHunter: Call of the Wild", "518790", [
      "Survival",
      "Hunting",
    ]);

    assert.equal(
      selectCatalogueRecommendationEdge(breathOfTheWild, [hunting]),
      null
    );
  });

  it("accepts an exact normalized title even when it is not first", () => {
    const hunting = edge("theHunter: Call of the Wild", "518790", ["Survival"]);
    const zelda = edge(
      "The Legend of Zelda - Breath of the Wild",
      "botw-reference",
      ["Action", "Adventure"]
    );

    assert.equal(
      selectCatalogueRecommendationEdge(breathOfTheWild, [hunting, zelda]),
      zelda
    );
  });

  it("prefers an exact shop/object identity over a title collision", () => {
    const titleCollision = edge("Shared title", "other", ["Puzzle"]);
    const identity = edge("Localized title", "42", ["RPG"]);

    assert.equal(
      selectCatalogueRecommendationEdge(
        { shop: "steam", objectId: "42", title: "Shared title" },
        [titleCollision, identity]
      ),
      identity
    );
  });

  const pcRoutingCases: ReadonlyArray<{
    name: string;
    entries: ReadonlyArray<{
      shop: string;
      objectId: string;
      title: string;
      [key: string]: unknown;
    }>;
  }> = [
    {
      name: "library taste inputs",
      entries: [
        {
          ...breathOfTheWild,
          genres: ["Survival", "Hunting"],
          playTimeInMilliseconds: 80 * 3_600_000,
        },
        {
          shop: "steam",
          objectId: "1145360",
          title: "Hades",
          genres: ["Action", "Roguelike"],
          playTimeInMilliseconds: 20 * 3_600_000,
        },
      ],
    },
    {
      name: "recommendation feedback inputs",
      entries: [
        { ...breathOfTheWild, feedback: "like" as const },
        {
          shop: "steam",
          objectId: "1145360",
          title: "Hades",
          feedback: "like" as const,
        },
      ],
    },
  ];

  for (const { name, entries } of pcRoutingCases) {
    it(`routes launchbox games away from PC ${name}`, () => {
      const filtered = selectPcRecommendationGames(entries);

      assert.deepEqual(
        filtered.map(({ shop, title }) => ({ shop, title })),
        [{ shop: "steam", title: "Hades" }]
      );
      assert.equal(
        entries.some((game) => game.shop === "launchbox"),
        true
      );
    });
  }
});
