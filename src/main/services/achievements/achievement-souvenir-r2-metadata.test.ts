import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AchievementSouvenirRecord } from "@types";

import {
  achievementSouvenirMetadataFromRecord,
  achievementSouvenirRecordFromMetadata,
} from "./achievement-souvenir-r2-metadata";

const record: AchievementSouvenirRecord = {
  schemaVersion: 1,
  ownerId: "owner 1",
  shop: "steam",
  objectId: "123",
  achievementName: "ACH_WIN",
  achievementDisplayName: "Winner / Champion",
  achievementDescription: "Defeat the final boss & escape.",
  achievementIconUrl: "https://cdn.example/icon unlocked.png",
  gameTitle: "Example Game",
  gameIconUrl: null,
  unlockTime: 100,
  localPath: "C:\\shots\\win.jpeg",
  r2Key: null,
  status: "local",
  updatedAt: 200,
};

describe("achievement souvenir R2 metadata", () => {
  it("round-trips achievement presentation metadata", () => {
    const metadata = achievementSouvenirMetadataFromRecord(record);
    const restored = achievementSouvenirRecordFromMetadata(
      metadata,
      "users/owner/souvenir.jpeg",
      999
    );

    assert.equal(
      restored.achievementDescription,
      record.achievementDescription
    );
    assert.equal(restored.achievementIconUrl, record.achievementIconUrl);
    assert.equal(
      restored.achievementDisplayName,
      record.achievementDisplayName
    );
    assert.equal(restored.updatedAt, record.updatedAt);
    assert.equal(restored.status, "synced");
    assert.equal(restored.localPath, null);
  });

  it("normalizes legacy schema-v1 metadata without new fields", () => {
    const metadata = achievementSouvenirMetadataFromRecord(record);
    delete metadata.achievementdescription;
    delete metadata.achievementiconurl;

    const restored = achievementSouvenirRecordFromMetadata(
      metadata,
      "users/owner/legacy.jpeg",
      999
    );

    assert.equal(restored.achievementDescription, null);
    assert.equal(restored.achievementIconUrl, null);
  });
});
