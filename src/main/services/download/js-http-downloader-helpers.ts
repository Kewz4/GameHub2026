export const PROGRESS_RESET_THRESHOLD_BYTES = 16 * 1024 * 1024;
export const MAX_BUDGET_RESETS = 50;
export const MAX_RESUME_OVERLAP_BYTES = 1024 * 1024;

export const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ESOCKETTIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_REQ_RETRY",
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "network",
  "socket",
  "connection",
  "timeout",
  "aborted",
  "econnreset",
  "etimedout",
  "fetch failed",
];

// Transient HTTP statuses worth retrying with backoff (rate limits, gateway and
// upstream hiccups). Permanent 4xx (400/401/403/404/410) stay fatal so a dead
// link fails fast instead of looping.
export const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUS.has(status);
}

// Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs: number
): number | null {
  if (!headerValue) return null;

  const trimmed = headerValue.trim();
  if (trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }

  return null;
}

export function isRetryableDownloadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const retryableFlag = (err as { retryable?: unknown }).retryable;
  if (retryableFlag === true) return true;
  if (retryableFlag === false) return false;

  const nodeError = err as NodeJS.ErrnoException;
  if (nodeError.code && RETRYABLE_ERROR_CODES.has(nodeError.code)) {
    return true;
  }

  const cause = nodeError.cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as NodeJS.ErrnoException).code;
    if (
      typeof causeCode === "string" &&
      (RETRYABLE_ERROR_CODES.has(causeCode) || causeCode.startsWith("UND_ERR_"))
    ) {
      return true;
    }
  }

  const message = err.message.toLowerCase().trim();
  if (message === "terminated") return true;

  return RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment)
  );
}

export function computeFileSize(input: {
  status: number;
  contentRange: string | null;
  contentLength: string | null;
  startByte: number;
}): number | null {
  if (input.contentRange) {
    const match = /bytes \d+-\d+\/(\d+)/.exec(input.contentRange);
    if (match) {
      const total = Number.parseInt(match[1], 10);
      return Number.isFinite(total) ? total : null;
    }
    return null;
  }

  if (!input.contentLength) return null;

  const length = Number.parseInt(input.contentLength, 10);
  if (!Number.isFinite(length)) return null;

  return input.status === 206 ? input.startByte + length : length;
}

export interface ResumeAction {
  flags: "a" | "w";
  skipBytes: number;
  rangeIgnored: boolean;
  rejectReason:
    | "range-ignored"
    | "missing-content-range"
    | "range-gap"
    | "excessive-overlap"
    | null;
}

export function resolveResumeAction(input: {
  startByte: number;
  status: number;
  partialStart: number | null;
}): ResumeAction {
  if (input.startByte <= 0) {
    return {
      flags: "w",
      skipBytes: 0,
      rangeIgnored: false,
      rejectReason: null,
    };
  }

  // A resumed HTTP 200 means the server ignored Range and is resending the
  // entire object. Never consume that body: doing so can waste tens of GB on
  // every reconnect while appearing to make progress.
  if (input.status === 200) {
    return {
      flags: "a",
      skipBytes: 0,
      rangeIgnored: true,
      rejectReason: "range-ignored",
    };
  }

  if (input.status !== 206 || input.partialStart === null) {
    return {
      flags: "a",
      skipBytes: 0,
      rangeIgnored: false,
      rejectReason: "missing-content-range",
    };
  }

  if (input.partialStart > input.startByte) {
    // Appending would leave a hole. Preserve the partial instead of silently
    // truncating it and starting over.
    return {
      flags: "a",
      skipBytes: 0,
      rangeIgnored: false,
      rejectReason: "range-gap",
    };
  }

  if (input.partialStart < input.startByte) {
    const overlap = input.startByte - input.partialStart;
    if (overlap > MAX_RESUME_OVERLAP_BYTES) {
      return {
        flags: "a",
        skipBytes: 0,
        rangeIgnored: false,
        rejectReason: "excessive-overlap",
      };
    }

    // A small aligned overlap is acceptable; only these already-present bytes
    // are skipped, never an entire object returned with HTTP 200.
    return {
      flags: "a",
      skipBytes: overlap,
      rangeIgnored: false,
      rejectReason: null,
    };
  }

  return {
    flags: "a",
    skipBytes: 0,
    rangeIgnored: false,
    rejectReason: null,
  };
}

export function applySkip(
  remainingToSkip: number,
  chunkLength: number
): { newRemainingToSkip: number; writeOffset: number; shouldWrite: boolean } {
  if (remainingToSkip <= 0) {
    return { newRemainingToSkip: 0, writeOffset: 0, shouldWrite: true };
  }
  if (chunkLength <= remainingToSkip) {
    return {
      newRemainingToSkip: remainingToSkip - chunkLength,
      writeOffset: 0,
      shouldWrite: false,
    };
  }
  return {
    newRemainingToSkip: 0,
    writeOffset: remainingToSkip,
    shouldWrite: true,
  };
}

export function shouldResetRetryBudget(
  newBytesThisAttempt: number,
  budgetResets: number,
  thresholdBytes: number,
  maxResets: number
): boolean {
  return newBytesThisAttempt >= thresholdBytes && budgetResets < maxResets;
}

export function stallDetected(
  pendingReadSince: number | null,
  now: number,
  timeoutMs: number
): boolean {
  if (pendingReadSince === null) return false;
  return now - pendingReadSince > timeoutMs;
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(progress, 1));
}
