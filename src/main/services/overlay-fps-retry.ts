export const PRESENTMON_MAX_CAPTURE_ATTEMPTS = 3;

const PRESENTMON_RETRY_DELAYS_MS = [2_000, 6_000] as const;

export type PresentMonRetry = {
  delayMs: number;
  nextAttempt: number;
};

/**
 * PresentMon can successfully attach to ETW yet emit no frame events for a
 * particular launch. Treat that as a transient collector failure, but keep the
 * retry budget bounded so a game that genuinely cannot be captured does not
 * cause an endless sequence of elevated helpers.
 */
export const getPresentMonRetry = (
  completedAttempts: number
): PresentMonRetry | null => {
  const normalizedAttempts = Math.max(0, Math.trunc(completedAttempts));
  if (normalizedAttempts >= PRESENTMON_MAX_CAPTURE_ATTEMPTS) return null;

  return {
    nextAttempt: normalizedAttempts + 1,
    delayMs:
      PRESENTMON_RETRY_DELAYS_MS[
        Math.min(
          Math.max(0, normalizedAttempts - 1),
          PRESENTMON_RETRY_DELAYS_MS.length - 1
        )
      ],
  };
};
