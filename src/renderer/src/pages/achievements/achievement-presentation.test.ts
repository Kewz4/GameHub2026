import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ComparedAchievements, UserAchievement } from "@types";
import {
  resolveComparedOwnerStat,
  summarizeAchievementPoints,
} from "./achievement-presentation";

const achievement = (
  displayName: string,
  unlocked: boolean,
  points?: number
): UserAchievement => ({
  name: displayName.toLocaleLowerCase().replaceAll(" ", "_"),
  displayName,
  description: `${displayName} description`,
  icon: "icon.png",
  icongray: "locked.png",
  hidden: false,
  unlocked,
  unlockTime: unlocked ? 1234 : null,
  points,
});

describe("subscription-free achievement presentation", () => {
  it("calculates visible earned and available points from local definitions", () => {
    assert.deepEqual(
      summarizeAchievementPoints([
        achievement("First", true, 10),
        achievement("Second", false, 25),
      ]),
      { earned: 10, total: 35, hasPointData: true }
    );
  });

  it("reports unavailable point metadata without turning it into a paywall", () => {
    assert.deepEqual(summarizeAchievementPoints([achievement("First", true)]), {
      earned: 0,
      total: 0,
      hasPointData: false,
    });
  });

  it("fills an owner comparison stat from local progress when upstream omits it", () => {
    const compared = {
      displayName: "First Achievement!",
      description: "",
      hidden: false,
      icon: "icon.png",
      targetStat: { unlocked: false, unlockTime: 0 },
    } as ComparedAchievements["achievements"][number];

    assert.deepEqual(
      resolveComparedOwnerStat(compared, [
        achievement("First Achievement", true, 10),
      ]),
      { unlocked: true, unlockTime: 1234 }
    );
  });
});
