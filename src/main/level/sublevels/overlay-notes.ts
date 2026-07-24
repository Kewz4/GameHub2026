import { db } from "../level";

/**
 * Free-text note the user keeps per game, shown and edited in the in-game
 * overlay's Notes widget. Keyed by `${shop}:${objectId}` (levelKeys.game); the
 * value is the raw note text.
 */
export const overlayNotesSublevel = db.sublevel<string, string>(
  "overlayNotes",
  { valueEncoding: "utf8" }
);
