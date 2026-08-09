import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserGame } from "@types";
import {
  dedupeProfileGames,
  mergeProfileGameCollections,
  profileGameKey,
  sortProfileGames,
  totalProfilePlayTimeInSeconds,
} from "./profile-library-data";

const game = (
  shop: UserGame["shop"],
  objectId: string,
  title: string,
  overrides: Partial<UserGame> = {}
) =>
  ({
    shop,
    objectId,
    title,
    playTimeInSeconds: 0,
    unlockedAchievementCount: 0,
    achievementCount: 0,
    achievementsPointsEarnedSum: 0,
    lastTimePlayed: null,
    ...overrides,
  }) as UserGame;

describe("profile library data", () => {
  it("uses shop and objectId as the stable identity", () => {
    assert.equal(profileGameKey(game("steam", "10", "A")), "steam:10");
    assert.equal(profileGameKey(game("gog", "10", "A")), "gog:10");
  });

  it("collapses exact-title imports while keeping richer progress", () => {
    const result = dedupeProfileGames([
      game("custom", "a", "The Legend of Zelda - Ocarina of Time 3D", {
        playTimeInSeconds: 120,
      }),
      game("launchbox", "b", "The Legend of Zelda: Ocarina of Time 3D", {
        unlockedAchievementCount: 12,
        achievementCount: 85,
      }),
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].playTimeInSeconds, 120);
    assert.equal(result[0].unlockedAchievementCount, 12);
    assert.equal(result[0].achievementCount, 85);
  });

  it("never renders a pinned game again in the library", () => {
    const shared = game("steam", "10", "Shared", { isPinned: true });
    const result = mergeProfileGameCollections({
      serverLibrary: [shared],
      serverPinned: [shared],
      localLibrary: [],
      localPinned: [shared],
      sortBy: "playedRecently",
    });

    assert.equal(result.pinned.length, 1);
    assert.equal(result.library.length, 0);
  });

  it("sorts every displayed game with stable title tie-breaking", () => {
    const games = [
      game("steam", "a", "Alpha", { unlockedAchievementCount: 2 }),
      game("steam", "b", "Beta", { unlockedAchievementCount: 7 }),
      game("steam", "c", "Charlie", { unlockedAchievementCount: 7 }),
    ];

    assert.deepEqual(
      sortProfileGames(games, "achievementCount").map((item) => item.title),
      ["Beta", "Charlie", "Alpha"]
    );
  });

  it("totals playtime across every displayed game without negative values", () => {
    assert.equal(
      totalProfilePlayTimeInSeconds([
        game("steam", "one", "One", { playTimeInSeconds: 120 }),
        game("steam", "two", "Two", { playTimeInSeconds: 360 }),
        game("steam", "three", "Three", { playTimeInSeconds: -10 }),
      ]),
      480
    );
  });
});
