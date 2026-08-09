import assert from "node:assert/strict";
import test from "node:test";

import { selectBestCatalogueMatch } from "./catalogue-title-match";

const entry = (objectId: string, title: string) => ({
  objectId,
  title,
  shop: "steam" as const,
});

test("finds exact catalogue titles outside the first five results", () => {
  const entries = [
    entry("1", "Football Manager 26"),
    entry("2", "Football Manager 2023"),
    entry("3", "Football Manager 2024"),
    entry("4", "Football Manager 2021"),
    entry("5", "Football Manager 2020"),
    entry("6", "Football Manager 2022"),
    entry("7", "Football Manager 2021 Touch"),
  ];
  assert.equal(
    selectBestCatalogueMatch("Football Manager 2021 Touch", entries)?.objectId,
    "7"
  );
});

test("accepts safe store-specific suffixes", () => {
  assert.equal(
    selectBestCatalogueMatch("33 Immortals Beta", [entry("1", "33 Immortals")])
      ?.objectId,
    "1"
  );
  assert.equal(
    selectBestCatalogueMatch("Rise of the Tomb Raider: 20 Year Celebration", [
      entry("2", "Rise of the Tomb Raider™"),
    ])?.objectId,
    "2"
  );
  assert.equal(
    selectBestCatalogueMatch("The Vanishing of Ethan Carter Redux", [
      entry("3", "The Vanishing of Ethan Carter"),
    ])?.objectId,
    "3"
  );
});

test("does not turn a base game or content placeholder into another game", () => {
  assert.equal(
    selectBestCatalogueMatch("God of War", [
      entry("1", "God of War III Remastered"),
    ]),
    null
  );
  assert.equal(
    selectBestCatalogueMatch("Death Stranding Content", [
      entry("2", "DEATH STRANDING DIRECTOR'S CUT"),
    ]),
    null
  );
});
