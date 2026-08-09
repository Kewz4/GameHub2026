import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PlaynitePlaytimeCacheEntry } from "../level";
import {
  assignPlayniteCacheEntriesToGames,
  buildUnresolvedPlaynitePlaytimeCacheKey,
  selectPlayniteCacheEntryForGame,
} from "./playnite-playtime-cache-policy";

const entry = (
  overrides: Partial<PlaynitePlaytimeCacheEntry> = {}
): PlaynitePlaytimeCacheEntry => ({
  shop: "steam",
  objectId: "old-id",
  title: "Marvel's Spider-Man Remastered",
  playTimeInMilliseconds: 10,
  updatedAt: 1,
  ...overrides,
});

describe("Playnite playtime cache", () => {
  it("builds a stable unresolved identity without exposing the title", () => {
    const first = buildUnresolvedPlaynitePlaytimeCacheKey(
      "Hades II",
      "1145350"
    );
    const second = buildUnresolvedPlaynitePlaytimeCacheKey(
      "Hades II",
      "1145350"
    );
    assert.equal(first, second);
    assert.match(first, /^unresolved:[a-f0-9]{64}$/);
    assert.equal(first.includes("Hades"), false);
  });

  it("prefers the exact canonical key over title fallbacks", () => {
    const selected = selectPlayniteCacheEntryForGame(
      [
        ["unresolved:a", entry({ updatedAt: 100 })],
        ["steam:1817070", entry({ objectId: "1817070", updatedAt: 1 })],
      ],
      {
        shop: "steam",
        objectId: "1817070",
        title: "Marvel’s Spider-Man Remastered",
      }
    );
    assert.equal(selected?.[0], "steam:1817070");
  });

  it("recovers a catalogue-independent entry by source id or compact title", () => {
    const bySource = selectPlayniteCacheEntryForGame(
      [
        [
          "unresolved:a",
          entry({ sourceGameId: "1817070", normalizedTitle: "different" }),
        ],
      ],
      { shop: "steam", objectId: "1817070", title: "Different" }
    );
    assert.equal(bySource?.[0], "unresolved:a");

    const byTitle = selectPlayniteCacheEntryForGame(
      [["unresolved:b", entry()]],
      {
        shop: "epic",
        objectId: "epic-offer",
        title: "Marvel’s Spider-Man Remastered",
      }
    );
    assert.equal(byTitle?.[0], "unresolved:b");
  });

  it("does not conflate the same object id across different stores", () => {
    const selected = selectPlayniteCacheEntryForGame(
      [["unresolved:c", entry({ objectId: "shared-id", title: "Game A" })]],
      { shop: "epic", objectId: "shared-id", title: "Game B" }
    );
    assert.equal(selected, null);
  });

  it("never applies one title-only cache row to duplicate library cards", () => {
    const assignments = assignPlayniteCacheEntriesToGames(
      [["unresolved:d", entry({ objectId: "unknown" })]],
      [
        {
          key: "custom:a",
          shop: "custom",
          objectId: "a",
          title: "Marvel's Spider-Man Remastered",
        },
        {
          key: "launchbox:b",
          shop: "launchbox",
          objectId: "b",
          title: "Marvel’s Spider-Man Remastered",
        },
      ]
    );
    assert.equal(assignments.size, 0);
  });

  it("assigns exact identities before a unique title fallback", () => {
    const assignments = assignPlayniteCacheEntriesToGames(
      [
        ["steam:10", entry({ objectId: "10", title: "Exact" })],
        ["unresolved:e", entry({ objectId: "unknown", title: "Unique" })],
      ],
      [
        { key: "steam:10", shop: "steam", objectId: "10", title: "Exact" },
        {
          key: "epic:unique",
          shop: "epic",
          objectId: "unique",
          title: "Unique",
        },
      ]
    );
    assert.equal(assignments.get("steam:10")?.selected[0], "steam:10");
    assert.equal(assignments.get("epic:unique")?.selected[0], "unresolved:e");
  });
});
