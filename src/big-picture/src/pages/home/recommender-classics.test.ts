import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { CatalogueSearchResult, LibraryGame } from "@types";

import {
  getRecommendedClassics,
  selectClassicsCatalogueResultForGame,
} from "./recommender-classics";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("Big Picture classics recommendations", () => {
  it("learns BOTW genres only from its exact local catalogue identity", () => {
    const botw = {
      id: "local-wiiu-botw",
      shop: "launchbox",
      objectId: "local-wiiu-botw",
      title: "The Legend of Zelda: Breath of the Wild",
    } as LibraryGame;
    const hunting = {
      id: "hunting",
      shop: "launchbox",
      objectId: "minerva:wiiu:hunting-simulator-2",
      title: "Hunting Simulator 2",
      genres: ["Survival", "Hunting"],
      releaseYear: null,
      libraryImageUrl: null,
      downloadSources: [],
    } as CatalogueSearchResult;
    const exactBotw = {
      ...hunting,
      id: "botw",
      objectId: "minerva:wiiu:the-legend-of-zelda-breath-of-the-wild",
      title: "The Legend of Zelda - Breath of the Wild",
      genres: ["Action", "Adventure"],
    } as CatalogueSearchResult;

    assert.equal(
      selectClassicsCatalogueResultForGame(botw, [hunting, exactBotw]),
      exactBotw
    );
  });

  it("does not turn BOTW into a survival recommendation cluster", async () => {
    const botw = {
      id: "local-wiiu-botw",
      shop: "launchbox",
      objectId: "local-wiiu-botw",
      title: "The Legend of Zelda: Breath of the Wild",
      playTimeInMilliseconds: 80 * 3_600_000,
      platform: "Nintendo Wii U",
    } as LibraryGame;
    const result = (title: string, objectId: string, genres: string[]) =>
      ({
        id: objectId,
        shop: "launchbox",
        objectId,
        title,
        genres,
        releaseYear: null,
        libraryImageUrl: null,
        downloadSources: [],
      }) as CatalogueSearchResult;
    const hunting = result(
      "Hunting Simulator 2",
      "minerva:switch:hunting-simulator-2",
      ["Survival", "Hunting"]
    );
    const exactBotw = result(
      "The Legend of Zelda - Breath of the Wild",
      "minerva:wiiu:the-legend-of-zelda-breath-of-the-wild",
      ["Action", "Adventure"]
    );
    const adventure = result(
      "Immortals Fenyx Rising",
      "minerva:switch:immortals-fenyx-rising",
      ["Action", "Adventure"]
    );

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        electron: {
          leveldb: { values: async () => [] },
          searchClassicsCatalogue: async (query: string) =>
            query === botw.title ? [hunting, exactBotw] : [],
          getRandomClassics: async () => [hunting, adventure],
        },
      },
    });

    const recommendations = await getRecommendedClassics([botw]);

    assert.deepEqual(
      recommendations.map((game) => game.title),
      [adventure.title]
    );
    assert.equal(
      recommendations[0]?.recommendationReason,
      "Action classics match what you play"
    );
  });

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
