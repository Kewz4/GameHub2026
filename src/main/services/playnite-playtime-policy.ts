export const PLAYNITE_PLAYTIME_REPLACE_THRESHOLD_MS = 5 * 60 * 60 * 1000;

/**
 * A real catalogue audit found exact matches below the first 20 popularity
 * results (Football Manager 2021 Touch was result 26). Keep the lookup bounded
 * while leaving enough room for exact-id/title matching to find those games.
 */
export const PLAYNITE_CATALOGUE_SEARCH_TAKE = 50;

export type PlaynitePlaytimeDecision =
  | {
      action: "replace";
      previousPlaytimeMs: number;
      nextPlaytimeMs: number;
      deltaMs: number;
      reason: "below-five-hours";
    }
  | {
      action: "preserve";
      previousPlaytimeMs: number;
      nextPlaytimeMs: number;
      deltaMs: 0;
      reason: "protected-existing-playtime" | "invalid-import";
    };

export type PlayniteAbsolutePlaytimeAcknowledgement =
  | { action: "ignore" }
  | {
      action: "clear" | "requeue";
      pendingAbsolutePlayTimeInMilliseconds: number | null;
      unsyncedDeltaPlayTimeInMilliseconds: 0;
    };

const normalizeMilliseconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;

/**
 * Playnite is authoritative only while GameHub has less than five hours for a
 * game. Once GameHub reaches that threshold, an import must never replace the
 * value, even when Playnite reports more time. This protects current GameHub
 * sessions while still repairing missing or obviously incomplete histories.
 */
export const decidePlaynitePlaytimeImport = (
  existingPlaytimeMs: number | null | undefined,
  importedPlaytimeMs: number | null | undefined
): PlaynitePlaytimeDecision => {
  const previousPlaytimeMs = normalizeMilliseconds(existingPlaytimeMs);
  const nextPlaytimeMs = normalizeMilliseconds(importedPlaytimeMs);

  if (nextPlaytimeMs <= 0) {
    return {
      action: "preserve",
      previousPlaytimeMs,
      nextPlaytimeMs: previousPlaytimeMs,
      deltaMs: 0,
      reason: "invalid-import",
    };
  }

  if (previousPlaytimeMs >= PLAYNITE_PLAYTIME_REPLACE_THRESHOLD_MS) {
    return {
      action: "preserve",
      previousPlaytimeMs,
      nextPlaytimeMs: previousPlaytimeMs,
      deltaMs: 0,
      reason: "protected-existing-playtime",
    };
  }

  return {
    action: "replace",
    previousPlaytimeMs,
    nextPlaytimeMs,
    deltaMs: nextPlaytimeMs - previousPlaytimeMs,
    reason: "below-five-hours",
  };
};

/**
 * Reconcile an acknowledgement for an absolute Playnite correction with the
 * latest local record. A game can keep accruing playtime while the request is
 * in flight. In that case the acknowledged value is no longer current, so the
 * latest absolute value must remain queued for the next retry instead of being
 * lost when the old marker is cleared.
 */
export const reconcilePlayniteAbsolutePlaytimeAcknowledgement = (
  currentPlaytimeInMilliseconds: number | null | undefined,
  currentPendingAbsolutePlayTimeInMilliseconds: number | null | undefined,
  acknowledgedPlaytimeInMilliseconds: number
): PlayniteAbsolutePlaytimeAcknowledgement => {
  if (
    currentPendingAbsolutePlayTimeInMilliseconds !==
    acknowledgedPlaytimeInMilliseconds
  ) {
    return { action: "ignore" };
  }

  const latestPlaytimeInMilliseconds = normalizeMilliseconds(
    currentPlaytimeInMilliseconds
  );
  if (latestPlaytimeInMilliseconds !== acknowledgedPlaytimeInMilliseconds) {
    return {
      action: "requeue",
      pendingAbsolutePlayTimeInMilliseconds: latestPlaytimeInMilliseconds,
      unsyncedDeltaPlayTimeInMilliseconds: 0,
    };
  }

  return {
    action: "clear",
    pendingAbsolutePlayTimeInMilliseconds: null,
    unsyncedDeltaPlayTimeInMilliseconds: 0,
  };
};
