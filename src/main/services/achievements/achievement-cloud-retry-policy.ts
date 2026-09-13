const RETRY_DELAYS_MS = [0, 250, 1_000] as const;

interface ErrorWithTransportDetails {
  code?: string;
  response?: { status?: number };
}

export const achievementSyncAttemptCount = RETRY_DELAYS_MS.length;

export const achievementSyncRetryDelay = (attempt: number): number =>
  RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];

export const isRetryableAchievementSyncError = (error: unknown): boolean => {
  const transport = error as ErrorWithTransportDetails;
  const status = transport?.response?.status;

  if (status != null) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  return Boolean(
    transport?.code &&
      [
        "ECONNABORTED",
        "ECONNRESET",
        "ENETDOWN",
        "ENETUNREACH",
        "EPIPE",
        "ETIMEDOUT",
      ].includes(transport.code)
  );
};
