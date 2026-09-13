import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import type { AchievementSouvenirRecord } from "@types";
import {
  achievementSouvenirR2Key,
  achievementSouvenirOwnerRoot,
  achievementSouvenirRecordKey,
  achievementSouvenirScreenshotPath,
  isOwnedAchievementSouvenirPath,
  isUnownedLegacyAchievementSouvenirPath,
  isAchievementSouvenirRecord,
  mergeAchievementSouvenirRecords,
  profileAchievementSouvenirFromRecord,
  selectAchievementSouvenirCleanupCandidates,
} from "./achievement-souvenir-policy";

const baseRecord: AchievementSouvenirRecord = {
  schemaVersion: 1,
  ownerId: "user-1",
  shop: "steam",
  objectId: "123",
  achievementName: "ACH_WIN",
  achievementDisplayName: "Win / Once",
  gameTitle: "CON",
  gameIconUrl: null,
  unlockTime: 100,
  localPath: "C:\\shots\\one.jpeg",
  r2Key: null,
  status: "local",
  updatedAt: 200,
};

describe("achievement souvenir policy", () => {
  it("keys records case-insensitively and scopes them to the owner", () => {
    assert.equal(
      achievementSouvenirRecordKey("user-1", "steam", "123", " ach_win "),
      achievementSouvenirRecordKey("user-1", "steam", "123", "ACH_WIN")
    );
    assert.notEqual(
      achievementSouvenirRecordKey("user-2", "steam", "123", "ACH_WIN"),
      achievementSouvenirRecordKey("user-1", "steam", "123", "ACH_WIN")
    );
  });

  it("uses deterministic opaque R2 filenames without exposing display text", () => {
    const key = achievementSouvenirR2Key("user-1", "steam", "123", "ACH_WIN");
    assert.match(
      key,
      /^users\/user-1\/achievement-souvenirs\/steam\/123\/[a-f0-9]{64}\.jpeg$/
    );
    assert.doesNotMatch(key, /ACH_WIN/);
  });

  it("keeps sanitized display-name collisions separate with stable ids", () => {
    const root = path.join("C:\\", "Shots");
    const first = achievementSouvenirScreenshotPath(root, {
      ownerId: "user-1",
      shop: "steam",
      objectId: "123",
      gameTitle: "CON",
      achievementName: "ACH_ONE",
      achievementDisplayName: "Win/Once",
    });
    const second = achievementSouvenirScreenshotPath(root, {
      ownerId: "user-1",
      shop: "steam",
      objectId: "123",
      gameTitle: "CON",
      achievementName: "ACH_TWO",
      achievementDisplayName: "Win:Once",
    });
    assert.notEqual(first, second);
    assert.match(first, /_CON-/);
  });

  it("keeps identical souvenirs in opaque account-owned paths", () => {
    const root = path.join("C:\\", "Shots");
    const input = {
      shop: "steam" as const,
      objectId: "123",
      gameTitle: "Shared Game",
      achievementName: "ACH_WIN",
      achievementDisplayName: "Winner",
    };
    const accountA = achievementSouvenirScreenshotPath(root, {
      ...input,
      ownerId: "account-a",
    });
    const accountB = achievementSouvenirScreenshotPath(root, {
      ...input,
      ownerId: "account-b",
    });

    assert.notEqual(accountA, accountB);
    assert.equal(
      isOwnedAchievementSouvenirPath(root, "account-a", accountA),
      true
    );
    assert.equal(
      isOwnedAchievementSouvenirPath(root, "account-b", accountA),
      false
    );
    assert.equal(accountA.includes("account-a"), false);
    assert.equal(
      path.dirname(path.dirname(accountA)),
      achievementSouvenirOwnerRoot(root, "account-a")
    );
  });

  it("separates legacy unowned paths from every account namespace", () => {
    const root = path.join("C:\\", "Shots");
    const legacy = path.join(root, "Shared Game-old", "Winner-old.jpeg");
    const owned = achievementSouvenirScreenshotPath(root, {
      ownerId: "account-a",
      shop: "steam",
      objectId: "123",
      gameTitle: "Shared Game",
      achievementName: "ACH_WIN",
      achievementDisplayName: "Winner",
    });

    assert.equal(isUnownedLegacyAchievementSouvenirPath(root, legacy), true);
    assert.equal(isUnownedLegacyAchievementSouvenirPath(root, owned), false);
  });

  it("bounds account-local storage without pruning an active upload", () => {
    const root = path.join("C:\\", "Shots", "owner");
    const activeUpload = path.join(root, "active.jpeg");
    const oldest = path.join(root, "oldest.jpeg");
    const newest = path.join(root, "newest.jpeg");

    assert.deepEqual(
      selectAchievementSouvenirCleanupCandidates(
        [
          { path: activeUpload, modifiedAt: 1 },
          { path: oldest, modifiedAt: 2 },
          { path: newest, modifiedAt: 3 },
        ],
        [activeUpload],
        2
      ).map((entry) => entry.path),
      [oldest]
    );
  });

  it("preserves a durable deletion fence over a remote refresh", () => {
    const pending = { ...baseRecord, status: "pending-delete" as const };
    const remote = {
      ...baseRecord,
      localPath: null,
      r2Key: "users/user-1/achievement-souvenirs/steam/123/key.jpeg",
      status: "synced" as const,
      updatedAt: 300,
    };
    assert.equal(
      mergeAchievementSouvenirRecords(pending, remote).status,
      "pending-delete"
    );
  });

  it("rejects malformed persisted records", () => {
    // Existing schema-v1 records predate the presentation fields and remain
    // valid so upgrades never discard a user's screenshots.
    assert.equal(isAchievementSouvenirRecord(baseRecord), true);
    assert.deepEqual(
      profileAchievementSouvenirFromRecord(baseRecord, "local:one.jpeg"),
      {
        ownerId: "user-1",
        shop: "steam",
        objectId: "123",
        achievementName: "ACH_WIN",
        achievementDisplayName: "Win / Once",
        achievementDescription: null,
        achievementIconUrl: null,
        gameTitle: "CON",
        gameIconUrl: null,
        imageUrl: "local:one.jpeg",
        unlockTime: 100,
      }
    );
    assert.equal(
      isAchievementSouvenirRecord({
        ...baseRecord,
        achievementDescription: "Win once without taking damage.",
        achievementIconUrl: "https://cdn.example/win.png",
      }),
      true
    );
    assert.equal(
      isAchievementSouvenirRecord({ ...baseRecord, ownerId: "" }),
      false
    );
    assert.equal(
      isAchievementSouvenirRecord({
        ...baseRecord,
        achievementIconUrl: 42,
      }),
      false
    );
  });
});
