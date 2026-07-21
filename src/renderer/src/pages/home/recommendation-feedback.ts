import { levelDBService } from "@renderer/services/leveldb.service";

/**
 * On-device feedback for "Recommended for you" cards, persisted so the
 * recommender remembers whether a suggestion landed. Stored locally only —
 * this is a private signal, never uploaded. Three distinct kinds:
 *
 *  - "like": folds the game's real genres/tags into the taste profile as a
 *    strong positive (like a favorite) — you'll see MORE games like it, and
 *    it's excluded from future recommendations (it's now "already known").
 *  - "dislike": folds the game's genres/tags in as a NEGATIVE weight — the
 *    taste model actively steers away from games that share its facets, so
 *    you'll see LESS of that kind of game — and it's excluded too.
 *  - "ignore": excludes the game from future recommendations ONLY. It has
 *    zero effect on the taste model — a purely mechanical "don't show me
 *    this specific game again" with no opinion about the kind of games it
 *    represents.
 */

const SUBLEVEL = "recommendationFeedback";

export type FeedbackKind = "like" | "dislike" | "ignore";

export interface FeedbackRecord {
  shop: string;
  objectId: string;
  title: string;
  /** Genres captured at feedback time, so a "like" can shape the taste profile. */
  genres: string[];
  feedback: FeedbackKind;
  updatedAt: number;
}

export const feedbackKey = (game: { shop: string; objectId: string }): string =>
  `${game.shop}:${game.objectId}`;

/** All stored feedback records. */
export async function getAllFeedback(): Promise<FeedbackRecord[]> {
  try {
    const values = (await levelDBService.values(SUBLEVEL)) as FeedbackRecord[];
    return Array.isArray(values) ? values.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Feedback keyed by `${shop}:${objectId}` for quick lookup in the UI. */
export async function getFeedbackMap(): Promise<Map<string, FeedbackRecord>> {
  const records = await getAllFeedback();
  return new Map(records.map((record) => [feedbackKey(record), record]));
}

/**
 * Set (or clear) feedback for a game. Passing `null` — or the same kind that's
 * already stored (a toggle) — removes the record, so a second tap on an active
 * thumb turns it back off.
 */
export async function setFeedback(
  game: { shop: string; objectId: string; title: string; genres?: string[] },
  feedback: FeedbackKind | null
): Promise<void> {
  const key = feedbackKey(game);
  try {
    if (feedback === null) {
      await levelDBService.del(key, SUBLEVEL);
    } else {
      const record: FeedbackRecord = {
        shop: game.shop,
        objectId: game.objectId,
        title: game.title,
        genres: game.genres ?? [],
        feedback,
        updatedAt: Date.now(),
      };
      await levelDBService.put(key, record, SUBLEVEL);
    }
    // Lets session-cached recommender shelves invalidate (see use-home-catalogue).
    window.dispatchEvent(new Event("recommendation-feedback-changed"));
  } catch {
    // Non-fatal — feedback is best-effort personalization, not critical state.
  }
}
