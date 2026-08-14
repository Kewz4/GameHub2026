export const VALID_TRACKER_PROTOCOLS = [
  "http:",
  "https:",
  "udp:",
  "ws:",
  "wss:",
] as const;

export const MAX_GLOBAL_TRACKERS = 128;
export const MAX_TRACKER_URL_LENGTH = 2_048;
export const MAX_TRACKER_LIST_TEXT_LENGTH = 65_536;

export type TrackerListValidationCode =
  | "invalid_tracker_list"
  | "too_many_trackers"
  | "tracker_list_too_large"
  | "invalid_tracker_url";

export class TrackerListValidationError extends Error {
  constructor(public readonly code: TrackerListValidationCode) {
    super(code);
    this.name = "TrackerListValidationError";
  }
}

const hasDisallowedWhitespace = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f;
  });

export const normalizeTrackerUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_TRACKER_URL_LENGTH ||
    hasDisallowedWhitespace(normalized) ||
    normalized.includes(":///")
  ) {
    return null;
  }

  try {
    const parsed = new URL(normalized);

    if (
      !VALID_TRACKER_PROTOCOLS.includes(
        parsed.protocol as (typeof VALID_TRACKER_PROTOCOLS)[number]
      ) ||
      !parsed.hostname ||
      parsed.hash
    ) {
      return null;
    }

    // Accessing URL.port also exercises the platform URL parser's port-range
    // validation. Keep the user's original, trimmed URL so private tracker
    // passkeys and percent-encoding are not rewritten.
    void parsed.port;
    return normalized;
  } catch {
    return null;
  }
};

export const isValidTrackerUrl = (value: unknown): value is string =>
  normalizeTrackerUrl(value) !== null;

export const parseTrackerList = (data: string): string[] => {
  if (typeof data !== "string") {
    throw new TrackerListValidationError("invalid_tracker_list");
  }

  if (data.length > MAX_TRACKER_LIST_TEXT_LENGTH) {
    throw new TrackerListValidationError("tracker_list_too_large");
  }

  return [
    ...new Set(
      data
        .split(/[\r\n]+/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
    ),
  ];
};

export const validateAndNormalizeTrackerUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw new TrackerListValidationError("invalid_tracker_list");
  }

  if (value.length > MAX_GLOBAL_TRACKERS) {
    throw new TrackerListValidationError("too_many_trackers");
  }

  const result: string[] = [];
  const seen = new Set<string>();
  let totalLength = 0;

  for (const item of value) {
    const tracker = normalizeTrackerUrl(item);
    if (!tracker) {
      throw new TrackerListValidationError("invalid_tracker_url");
    }

    totalLength += tracker.length;
    if (totalLength > MAX_TRACKER_LIST_TEXT_LENGTH) {
      throw new TrackerListValidationError("tracker_list_too_large");
    }

    if (!seen.has(tracker)) {
      seen.add(tracker);
      result.push(tracker);
    }
  }

  return result;
};

/**
 * Defensive reader for legacy or manually edited records. Persistence uses the
 * strict validator above; runtime download recovery drops malformed entries so
 * one corrupted preference cannot prevent every torrent from resuming.
 */
export const filterValidTrackerUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  let totalLength = 0;

  for (const item of value.slice(0, MAX_GLOBAL_TRACKERS)) {
    const tracker = normalizeTrackerUrl(item);
    if (!tracker || seen.has(tracker)) continue;

    totalLength += tracker.length;
    if (totalLength > MAX_TRACKER_LIST_TEXT_LENGTH) break;

    seen.add(tracker);
    result.push(tracker);
  }

  return result;
};

export const resolveConfiguredGlobalTrackers = (
  preferences: {
    globalTrackers?: unknown;
    appendGlobalTrackers?: unknown;
  } | null
): string[] => {
  if (preferences?.appendGlobalTrackers !== true) return [];
  return filterValidTrackerUrls(preferences.globalTrackers);
};
