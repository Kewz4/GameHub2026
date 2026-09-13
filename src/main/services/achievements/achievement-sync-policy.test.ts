import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  achievementPayloadFingerprint,
  canonicalizeAchievementDefinitions,
  canonicalizeUnlockedAchievements,
  getNewUnlockedAchievements,
} from "./achievement-sync-policy";

const definitions = [{ name: "ACH_FIRST" }, { name: "Achievement_Second" }];

describe("achievement sync policy", () => {
  it("filters stale source names and emits canonical definition casing", () => {
    assert.deepEqual(
      canonicalizeUnlockedAchievements(definitions, [
        { name: "exophase_123", unlockTime: 20 },
        { name: "ach_first", unlockTime: 10 },
        { name: "ACH_FIRST", unlockTime: 15 },
        { name: "achievement_second", unlockTime: 30 },
      ]),
      [
        { name: "ACH_FIRST", unlockTime: 10 },
        { name: "Achievement_Second", unlockTime: 30 },
      ]
    );
  });

  it("deduplicates definition rows by apiName", () => {
    const result = canonicalizeAchievementDefinitions([
      {
        name: "ACH_FIRST",
        displayName: "First",
        description: "",
        icon: "icon.png",
        icongray: "gray.png",
        hidden: false,
      },
      {
        name: "ach_first",
        displayName: "",
        description: "Duplicate",
        icon: "",
        icongray: "",
        hidden: false,
      },
    ]);
    assert.equal(result.length, 1);
    assert.deepEqual(
      {
        name: result[0].name,
        displayName: result[0].displayName,
        description: result[0].description,
        icon: result[0].icon,
      },
      {
        name: "ACH_FIRST",
        displayName: "First",
        description: "Duplicate",
        icon: "icon.png",
      }
    );
  });

  it("deduplicates without dropping offline unlocks when definitions are absent", () => {
    assert.deepEqual(
      canonicalizeUnlockedAchievements(
        [],
        [
          { name: "offline_unlock", unlockTime: 40 },
          { name: "OFFLINE_UNLOCK", unlockTime: 20 },
        ]
      ),
      [{ name: "offline_unlock", unlockTime: 20 }]
    );
  });

  it("reports only genuinely new canonical unlocks", () => {
    assert.deepEqual(
      getNewUnlockedAchievements(
        definitions,
        [{ name: "ACH_FIRST", unlockTime: 10 }],
        [
          { name: "ach_first", unlockTime: 20 },
          { name: "achievement_second", unlockTime: 30 },
          { name: "wrong_source_name", unlockTime: 40 },
        ]
      ),
      [{ name: "Achievement_Second", unlockTime: 30 }]
    );
  });

  it("fingerprints deterministic canonical payloads", () => {
    const payload = canonicalizeUnlockedAchievements(definitions, [
      { name: "achievement_second", unlockTime: 30 },
      { name: "ach_first", unlockTime: 10 },
    ]);

    assert.equal(
      achievementPayloadFingerprint(payload),
      "ACH_FIRST:10|ACHIEVEMENT_SECOND:30"
    );
  });
});
