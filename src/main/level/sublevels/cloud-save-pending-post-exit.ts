import { db } from "../level";
import { levelKeys } from "./keys";

export const cloudSavePendingPostExitSublevel = db.sublevel<string, unknown>(
  levelKeys.cloudSavePendingPostExit,
  { valueEncoding: "json" }
);
