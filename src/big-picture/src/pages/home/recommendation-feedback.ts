/**
 * On-device thumbs up/down feedback for "Recommended for you" cards, persisted
 * so the recommender remembers whether a suggestion landed. A "like" folds the
 * game's genres into the taste profile (as a strong positive, like a favorite),
 * while a "dislike" removes it from future recommendations. Stored locally only
 * — this is a private signal, never uploaded.
 *
 * Shares the same leveldb sublevel as the main renderer, so feedback given in
 * either UI applies to both.
 */

const SUBLEVEL = "recommendationFeedback";

export type FeedbackKind = "like" | "dislike";

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
    const values = (await globalThis.window.electron.leveldb.values(
      SUBLEVEL
    )) as FeedbackRecord[];
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
      await globalThis.window.electron.leveldb.del(key, SUBLEVEL);
    } else {
      const record: FeedbackRecord = {
        shop: game.shop,
        objectId: game.objectId,
        title: game.title,
        genres: game.genres ?? [],
        feedback,
        updatedAt: Date.now(),
      };
      await globalThis.window.electron.leveldb.put(key, record, SUBLEVEL);
    }
  } catch {
    // Non-fatal — feedback is best-effort personalization, not critical state.
  }
}
