import type { AchievementSouvenirRecord } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

export const achievementSouvenirsSublevel = db.sublevel<
  string,
  AchievementSouvenirRecord
>(levelKeys.achievementSouvenirs, { valueEncoding: "json" });
