import type {
  SpotifyControlAction,
  SpotifyPlaybackCommand,
  SpotifyProviderError,
} from "../../types/spotify.types";

const MAX_SEARCH_QUERY_LENGTH = 500;
const MAX_DEVICE_ID_LENGTH = 512;
const MAX_LIBRARY_LOOKUP_URIS = 400;
const MAX_SPOTIFY_URI_LENGTH = 512;
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]+$/;

export class SpotifyRateLimitGate {
  private blockedUntil = 0;
  private error: SpotifyProviderError | null = null;
  private readonly defaultRateLimitSeconds: number;
  private readonly defaultQuotaSeconds: number;

  constructor(defaultRateLimitSeconds: number, defaultQuotaSeconds: number) {
    this.defaultRateLimitSeconds = defaultRateLimitSeconds;
    this.defaultQuotaSeconds = defaultQuotaSeconds;
  }

  remember(error: SpotifyProviderError, now = Date.now()) {
    if (error.code !== "RATE_LIMITED" && error.code !== "QUOTA_EXCEEDED") {
      return;
    }
    const fallbackSeconds =
      error.code === "QUOTA_EXCEEDED"
        ? this.defaultQuotaSeconds
        : this.defaultRateLimitSeconds;
    const retryAfterSeconds =
      typeof error.retryAfterSeconds === "number" &&
      Number.isFinite(error.retryAfterSeconds)
        ? Math.max(1, Math.ceil(error.retryAfterSeconds))
        : fallbackSeconds;
    const proposedDeadline = now + retryAfterSeconds * 1000;
    if (
      proposedDeadline >= this.blockedUntil ||
      (error.code === "QUOTA_EXCEEDED" && this.error?.code !== "QUOTA_EXCEEDED")
    ) {
      this.blockedUntil = Math.max(this.blockedUntil, proposedDeadline);
      this.error = { ...error, retryAfterSeconds };
    }
  }

  getBlockedError(now = Date.now()): SpotifyProviderError | null {
    const remainingMs = this.blockedUntil - now;
    if (remainingMs <= 0) {
      this.blockedUntil = 0;
      this.error = null;
      return null;
    }

    return {
      ...(this.error ?? {
        code: "RATE_LIMITED",
        message: "Spotify is rate limiting this app. Try again shortly.",
        status: 429,
      }),
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }
}

export class SpotifyInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotifyInputValidationError";
  }
}

const inputError = (message: string) =>
  new SpotifyInputValidationError(message);

const asInputObject = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("Spotify received an invalid request.");
  }
  return value as Record<string, unknown>;
};

const nonEmptyString = (
  value: unknown,
  label: string,
  maximumLength = MAX_SPOTIFY_URI_LENGTH
): string => {
  if (typeof value !== "string") {
    throw inputError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) throw inputError(`${label} is required.`);
  if (normalized.length > maximumLength) {
    throw inputError(`${label} is too long.`);
  }
  return normalized;
};

const optionalDeviceId = (value: unknown): string | undefined =>
  value === undefined
    ? undefined
    : nonEmptyString(value, "Spotify device ID", MAX_DEVICE_ID_LENGTH);

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw inputError(`${label} must be a finite number.`);
  }
  return value;
};

const optionalBoolean = (
  value: unknown,
  label: string
): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw inputError(`${label} must be a boolean.`);
  }
  return value;
};

export type SpotifyUriType = "track" | "playlist" | "show" | "episode";

export const isSpotifyUri = (
  value: string,
  allowedTypes: readonly SpotifyUriType[]
): boolean => {
  if (value.length > MAX_SPOTIFY_URI_LENGTH) return false;
  const match = /^spotify:(track|playlist|show|episode):([A-Za-z0-9]+)$/.exec(
    value
  );
  return Boolean(
    match &&
      allowedTypes.includes(match[1] as SpotifyUriType) &&
      SPOTIFY_ID_PATTERN.test(match[2])
  );
};

const spotifyUri = (
  value: unknown,
  label: string,
  allowedTypes: readonly SpotifyUriType[]
): string => {
  const uri = nonEmptyString(value, label);
  if (!isSpotifyUri(uri, allowedTypes)) {
    throw inputError(`${label} is not a supported Spotify URI.`);
  }
  return uri;
};

export const parseSpotifySearchQuery = (value: unknown): string => {
  if (typeof value !== "string") {
    throw inputError("Spotify search query must be a string.");
  }
  const query = value.trim();
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    throw inputError("Spotify search query is too long.");
  }
  return query;
};

export interface SpotifyPlaylistItemsRequest {
  playlistId: string;
  offset: number;
}

export const parseSpotifyPlaylistItemsRequest = (
  playlistIdValue: unknown,
  offsetValue: unknown
): SpotifyPlaylistItemsRequest => {
  const playlistId = nonEmptyString(
    playlistIdValue,
    "Spotify playlist ID",
    128
  );
  if (!SPOTIFY_ID_PATTERN.test(playlistId)) {
    throw inputError("Spotify playlist ID is invalid.");
  }

  const offset =
    offsetValue === undefined ? 0 : finiteNumber(offsetValue, "Offset");
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw inputError("Offset must be a non-negative integer.");
  }
  return { playlistId, offset };
};

export const parseSpotifySavedItemRequest = (
  uriValue: unknown,
  savedValue: unknown
): { uri: string; saved: boolean } => {
  const uri = spotifyUri(uriValue, "Spotify library URI", [
    "track",
    "show",
    "episode",
  ]);
  if (typeof savedValue !== "boolean") {
    throw inputError("Spotify saved state must be a boolean.");
  }
  return { uri, saved: savedValue };
};

export const parseSpotifyLibraryUris = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw inputError("Spotify library URIs must be an array.");
  }
  if (value.length > MAX_LIBRARY_LOOKUP_URIS) {
    throw inputError(
      `Spotify library lookups support at most ${MAX_LIBRARY_LOOKUP_URIS} items.`
    );
  }
  return [
    ...new Set(
      value.map((uri) =>
        spotifyUri(uri, "Spotify library URI", ["track", "show", "episode"])
      )
    ),
  ];
};

export const parseSpotifyControlAction = (
  value: unknown
): SpotifyControlAction => {
  if (
    value !== "play" &&
    value !== "pause" &&
    value !== "next" &&
    value !== "previous"
  ) {
    throw inputError("Spotify control action is invalid.");
  }
  return value;
};

export const parseSpotifyPlaybackCommand = (
  value: unknown
): SpotifyPlaybackCommand => {
  const command = asInputObject(value);
  const type = nonEmptyString(command.type, "Spotify command type", 64);
  const deviceId = optionalDeviceId(command.deviceId);

  switch (type) {
    case "play":
    case "pause":
    case "next":
    case "previous":
      return { type, deviceId };
    case "play-item": {
      if (command.itemType !== "track" && command.itemType !== "playlist") {
        throw inputError("Spotify play item type must be a track or playlist.");
      }
      const itemType = command.itemType;
      const uri = spotifyUri(command.uri, "Spotify playback URI", [itemType]);
      const offsetUri =
        command.offsetUri === undefined
          ? undefined
          : spotifyUri(command.offsetUri, "Spotify playback offset URI", [
              "track",
              "episode",
            ]);
      if (itemType !== "playlist" && offsetUri !== undefined) {
        throw inputError(
          "A Spotify playback offset requires a playlist context."
        );
      }
      return { type, uri, itemType, deviceId, offsetUri };
    }
    case "add-to-queue":
      return {
        type,
        uri: spotifyUri(command.uri, "Spotify queue URI", ["track", "episode"]),
        deviceId,
      };
    case "seek": {
      const positionMs = finiteNumber(
        command.positionMs,
        "Spotify seek position"
      );
      if (positionMs < 0) {
        throw inputError("Spotify seek position cannot be negative.");
      }
      return { type, positionMs, deviceId };
    }
    case "volume": {
      const volumePercent = finiteNumber(
        command.volumePercent,
        "Spotify volume"
      );
      if (volumePercent < 0 || volumePercent > 100) {
        throw inputError("Spotify volume must be between 0 and 100.");
      }
      return { type, volumePercent, deviceId };
    }
    case "shuffle":
      if (typeof command.enabled !== "boolean") {
        throw inputError("Spotify shuffle state must be a boolean.");
      }
      return { type, enabled: command.enabled, deviceId };
    case "repeat":
      if (
        command.state !== "off" &&
        command.state !== "track" &&
        command.state !== "context"
      ) {
        throw inputError("Spotify repeat state is invalid.");
      }
      return { type, state: command.state, deviceId };
    case "transfer":
      return {
        type,
        deviceId: nonEmptyString(
          command.deviceId,
          "Spotify device ID",
          MAX_DEVICE_ID_LENGTH
        ),
        play: optionalBoolean(command.play, "Spotify transfer play state"),
      };
    default:
      throw inputError("Spotify command type is unsupported.");
  }
};

export const sixCalendarMonthsAfter = (timestamp: number): number => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;

  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 6);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return date.getTime();
};

export type SpotifyCallbackParseResult =
  | { kind: "ignore"; status: 400 | 404 | 405 }
  | {
      kind: "oauth-error";
      error: string;
      description: string;
      status: 400;
    }
  | { kind: "missing-code"; status: 400 }
  | { kind: "success"; code: string; status: 200 };

export const parseSpotifyCallbackRequest = ({
  expectedState,
  method,
  redirectUri,
  requestUrl,
}: {
  expectedState: string;
  method: string | undefined;
  redirectUri: string;
  requestUrl: string | undefined;
}): SpotifyCallbackParseResult => {
  if (method !== "GET") return { kind: "ignore", status: 405 };

  try {
    const expectedUrl = new URL(redirectUri);
    const requestTarget = new URL(requestUrl ?? "/", expectedUrl);
    if (
      requestTarget.origin !== expectedUrl.origin ||
      requestTarget.pathname !== expectedUrl.pathname
    ) {
      return { kind: "ignore", status: 404 };
    }

    if (requestTarget.searchParams.get("state") !== expectedState) {
      return { kind: "ignore", status: 400 };
    }

    const oauthError = requestTarget.searchParams.get("error");
    if (oauthError) {
      return {
        kind: "oauth-error",
        error: oauthError,
        description: requestTarget.searchParams.get("error_description") ?? "",
        status: 400,
      };
    }

    const code = requestTarget.searchParams.get("code");
    if (!code) return { kind: "missing-code", status: 400 };
    return { kind: "success", code, status: 200 };
  } catch {
    return { kind: "ignore", status: 400 };
  }
};
