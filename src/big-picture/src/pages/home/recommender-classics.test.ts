import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { CatalogueSearchResult, LibraryGame } from "@types";

import { getRecommendedClassics } from "./recommender-classics";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("Big Picture classics recommendations", () => {
  it("learns a local ROM's console instead of requiring a minerva id", async () => {
    const candidate = {
      id: "fantasy-life",
      shop: "launchbox",
      objectId: "minerva:n3ds:fantasy-life",
      title: "Fantasy Life",
      genres: [],
      releaseYear: null,
      libraryImageUrl: "https://cdn.example/fantasy-life.jpg",
      downloadSources: [],
    } as CatalogueSearchResult;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        electron: {
          leveldb: { values: async () => [] },
          searchClassicsCatalogue: async () => [],
          getRandomClassics: async () => [candidate],
        },
      },
    });
    const playedLocalRom = {
      id: "local-3ds",
      shop: "launchbox",
      objectId: "local-n3ds-a1b2c3",
      title: "The Legend of Zelda: A Link Between Worlds",
      playTimeInMilliseconds: 60 * 60 * 1_000,
    } as LibraryGame;

    const recommendations = await getRecommendedClassics([playedLocalRom]);

    assert.equal(recommendations.length, 1);
    assert.equal(recommendations[0].objectId, candidate.objectId);
    assert.equal(
      recommendations[0].recommendationReason,
      "Popular on consoles you play"
    );
  });
});
