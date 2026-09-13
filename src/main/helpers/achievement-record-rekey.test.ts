import assert from "node:assert/strict";
import test from "node:test";

import type { GameAchievement } from "@types";
import {
  mergeAchievementRecordForRekey,
  persistAchievementRecordRekey,
} from "./achievement-record-rekey";

const sourceRecord: GameAchievement = {
  achievements: [
    {
      name: "FIRST_SWING",
      displayName: "First Swing",
      icon: "local:first-swing",
      icongray: "local:first-swing-locked",
      hidden: false,
    },
  ],
  unlockedAchievements: [{ name: "FIRST_SWING", unlockTime: 1_700_000_000 }],
  achievementProgress: [{ name: "WEB_MASTER", current: 7, max: 10 }],
  language: "en",
  source: "exophase",
  catalogueValidator: "custom-history",
  updatedAt: 10,
};

test("custom to Steam rekey preserves local history when Steam has no achievement row", () => {
  const canonical = mergeAchievementRecordForRekey(null, sourceRecord, 20);

  assert.deepEqual(canonical, {
    ...sourceRecord,
    achievements: [...sourceRecord.achievements],
    unlockedAchievements: [...sourceRecord.unlockedAchievements],
    achievementProgress: [...(sourceRecord.achievementProgress ?? [])],
    updatedAt: 20,
  });
  assert.notEqual(canonical, sourceRecord);
  assert.notEqual(
    canonical.unlockedAchievements,
    sourceRecord.unlockedAchievements
  );
});

test("existing canonical row keeps its definitions and unions earliest unlocks", () => {
  const canonical = mergeAchievementRecordForRekey(
    {
      achievements: [
        {
          name: "FIRST_SWING",
          displayName: "Canonical First Swing",
          icon: "steam:unlocked",
          icongray: "steam:locked",
          hidden: false,
        },
      ],
      unlockedAchievements: [
        { name: "first_swing", unlockTime: 1_800_000_000 },
      ],
      language: "fr",
      updatedAt: 15,
    },
    sourceRecord,
    30
  );

  assert.equal(canonical.achievements[0]?.displayName, "Canonical First Swing");
  assert.equal(canonical.language, "fr");
  assert.deepEqual(canonical.unlockedAchievements, [
    { name: "FIRST_SWING", unlockTime: 1_700_000_000 },
  ]);
  assert.equal(canonical.updatedAt, 30);
});

test("rekey writes canonical history before removing the custom identity", async () => {
  const records = new Map<string, GameAchievement>([
    ["custom:local", sourceRecord],
  ]);
  const operations: string[] = [];

  await persistAchievementRecordRekey(
    "steam:2651280",
    "custom:local",
    null,
    sourceRecord,
    {
      put: async (key, record) => {
        operations.push(`put:${key}`);
        records.set(key, record);
      },
      remove: async (key) => {
        operations.push(`remove:${key}`);
        records.delete(key);
      },
    },
    40
  );

  assert.deepEqual(operations, ["put:steam:2651280", "remove:custom:local"]);
  assert.equal(records.has("custom:local"), false);
  assert.deepEqual(records.get("steam:2651280")?.unlockedAchievements, [
    { name: "FIRST_SWING", unlockTime: 1_700_000_000 },
  ]);
});
