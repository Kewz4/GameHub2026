import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AchievementGameStat, UserGame } from "@types";

import {
  dedupeProfileGames,
  getProfileLibraryPageOffsets,
  mergeAchievementStatsIntoProfileGames,
  mergeUniqueProfileGames,
  profileGameHasAchievements,
  sortProfileGames,
} from "./profile-data";

function profileGame(
  shop: UserGame["shop"],
  objectId: string,
  title: string,
  overrides: Partial<UserGame> = {}
) {
  return {
    shop,
    objectId,
    title,
    playTimeInSeconds: 0,
    lastTimePlayed: null,
    unlockedAchievementCount: 0,
    achievementCount: 0,
    achievementsPointsEarnedSum: 0,
    ...overrides,
  } as UserGame;
}

describe("Big Picture profile games", () => {
  it("keeps pinned order while removing games repeated by the library page", () => {
    const pinned = [profileGame("steam", "10", "Pinned")];
    const library = [
      profileGame("steam", "10", "Pinned duplicate"),
      profileGame("gog", "20", "Library game"),
    ];

    assert.deepEqual(
      mergeUniqueProfileGames(pinned, library).map((game) => game.title),
      ["Pinned", "Library game"]
    );
  });

  it("dedupes cross-source exact titles and keeps the richest values", () => {
    const result = dedupeProfileGames([
      profileGame("custom", "one", "Hades II", {
        playTimeInSeconds: 7200,
        iconUrl: "local-icon",
      }),
      profileGame("steam", "two", "Hades-II", {
        achievementCount: 50,
        unlockedAchievementCount: 31,
      }),
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].playTimeInSeconds, 7200);
    assert.equal(result[0].unlockedAchievementCount, 31);
    assert.equal(result[0].iconUrl, "local-icon");
  });

  it("applies the display limit after deduplication", () => {
    const pinned = [profileGame("steam", "10", "Pinned")];
    const library = [
      profileGame("steam", "10", "Pinned duplicate"),
      profileGame("gog", "20", "Second"),
      profileGame("epic", "30", "Third"),
    ];

    assert.deepEqual(
      mergeUniqueProfileGames(pinned, library, 2).map((game) => game.objectId),
      ["10", "20"]
    );
  });

  it("sorts the full dataset by recent, playtime, achievements, and title", () => {
    const games = [
      profileGame("steam", "b", "Beta", {
        playTimeInSeconds: 7200,
        unlockedAchievementCount: 3,
        lastTimePlayed: new Date("2026-01-01T00:00:00Z"),
      }),
      profileGame("steam", "a", "Alpha", {
        playTimeInSeconds: 3600,
        unlockedAchievementCount: 8,
        lastTimePlayed: new Date("2026-02-01T00:00:00Z"),
      }),
    ];

    assert.deepEqual(
      sortProfileGames(games, "playedRecently").map((game) => game.title),
      ["Alpha", "Beta"]
    );
    assert.deepEqual(
      sortProfileGames(games, "playtime").map((game) => game.title),
      ["Beta", "Alpha"]
    );
    assert.deepEqual(
      sortProfileGames(games, "achievementCount").map((game) => game.title),
      ["Alpha", "Beta"]
    );
    assert.deepEqual(
      sortProfileGames(games, "title").map((game) => game.title),
      ["Alpha", "Beta"]
    );
  });

  it("merges achievement-only games and filters progress from either count", () => {
    const stats: AchievementGameStat[] = [
      {
        shop: "xbox",
        objectId: "remote-only",
        title: "Achievement-only game",
        iconUrl: "achievement-icon",
        achievementCount: 10,
        unlockedAchievementCount: 4,
        inLibrary: false,
      },
    ];

    const merged = mergeAchievementStatsIntoProfileGames([], stats);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].iconUrl, "achievement-icon");
    assert.equal(profileGameHasAchievements(merged[0]), true);
  });

  it("returns every remaining pagination offset after the first page", () => {
    assert.deepEqual(getProfileLibraryPageOffsets(250, 100), [100, 200]);
    assert.deepEqual(getProfileLibraryPageOffsets(100, 100), []);
    assert.deepEqual(getProfileLibraryPageOffsets(250, 0), []);
  });
});
