import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  parseSpotifyCallbackRequest,
  parseSpotifyControlAction,
  parseSpotifyLibraryUris,
  parseSpotifyPlaybackCommand,
  parseSpotifyPlaylistItemsRequest,
  parseSpotifySavedItemRequest,
  parseSpotifySearchQuery,
  sixCalendarMonthsAfter,
  SpotifyInputValidationError,
  SpotifyRateLimitGate,
} from "../../src/main/services/spotify-helpers.ts";

const expectInvalidInput = (operation: () => unknown) => {
  assert.throws(
    operation,
    (error) => error instanceof SpotifyInputValidationError
  );
};

test("sixCalendarMonthsAfter clamps month ends in UTC", () => {
  const leapYearStart = Date.UTC(2023, 7, 31, 12, 34, 56, 789);
  assert.equal(
    new Date(sixCalendarMonthsAfter(leapYearStart)).toISOString(),
    "2024-02-29T12:34:56.789Z"
  );

  const ordinaryStart = Date.UTC(2024, 7, 31, 7, 8, 9, 10);
  assert.equal(
    new Date(sixCalendarMonthsAfter(ordinaryStart)).toISOString(),
    "2025-02-28T07:08:09.010Z"
  );
  assert.equal(sixCalendarMonthsAfter(0), 0);
});

test("SpotifyRateLimitGate blocks locally until Retry-After expires", () => {
  const gate = new SpotifyRateLimitGate(30, 60);
  gate.remember(
    {
      code: "RATE_LIMITED",
      message: "Slow down",
      status: 429,
      retryAfterSeconds: 5,
    },
    1_000
  );

  assert.equal(gate.getBlockedError(1_000)?.retryAfterSeconds, 5);
  assert.equal(gate.getBlockedError(5_001)?.retryAfterSeconds, 1);
  assert.equal(gate.getBlockedError(6_000), null);
});

test("quota backoff cannot shorten an existing block", () => {
  const gate = new SpotifyRateLimitGate(30, 60);
  gate.remember(
    {
      code: "RATE_LIMITED",
      message: "Slow down",
      retryAfterSeconds: 10,
    },
    0
  );
  gate.remember(
    {
      code: "QUOTA_EXCEEDED",
      message: "Quota reached",
      retryAfterSeconds: 2,
    },
    1_000
  );

  const blocked = gate.getBlockedError(1_000);
  assert.equal(blocked?.code, "QUOTA_EXCEEDED");
  assert.equal(blocked?.retryAfterSeconds, 9);
});

test("callback parsing validates state before OAuth error or code", () => {
  const redirectUri = "http://127.0.0.1:43123/callback";
  assert.deepEqual(
    parseSpotifyCallbackRequest({
      expectedState: "expected",
      method: "GET",
      redirectUri,
      requestUrl: "/callback?state=expected&code=valid-code",
    }),
    { kind: "success", code: "valid-code", status: 200 }
  );

  assert.deepEqual(
    parseSpotifyCallbackRequest({
      expectedState: "expected",
      method: "GET",
      redirectUri,
      requestUrl: "/callback?state=forged&error=access_denied",
    }),
    { kind: "ignore", status: 400 }
  );

  assert.deepEqual(
    parseSpotifyCallbackRequest({
      expectedState: "expected",
      method: "GET",
      redirectUri,
      requestUrl:
        "/callback?state=expected&error=access_denied&error_description=Denied",
    }),
    {
      kind: "oauth-error",
      error: "access_denied",
      description: "Denied",
      status: 400,
    }
  );
});

test("callback parsing ignores wrong origins, paths, and methods", () => {
  const redirectUri = "http://127.0.0.1:43123/callback";
  assert.deepEqual(
    parseSpotifyCallbackRequest({
      expectedState: "expected",
      method: "GET",
      redirectUri,
      requestUrl: "http://attacker.invalid/callback?state=expected&code=forged",
    }),
    { kind: "ignore", status: 404 }
  );
  assert.deepEqual(
    parseSpotifyCallbackRequest({
      expectedState: "expected",
      method: "GET",
      redirectUri,
      requestUrl: "/favicon.ico",
    }),
    { kind: "ignore", status: 404 }
  );
  assert.deepEqual(
    parseSpotifyCallbackRequest({
      expectedState: "expected",
      method: "POST",
      redirectUri,
      requestUrl: "/callback?state=expected&code=forged",
    }),
    { kind: "ignore", status: 405 }
  );
});

test("playback commands are normalized and unsafe payloads are rejected", () => {
  const command = parseSpotifyPlaybackCommand({
    type: "play-item",
    itemType: "playlist",
    uri: "spotify:playlist:abc123",
    offsetUri: "spotify:track:def456",
    deviceId: " device-1 ",
  });
  assert.deepEqual(command, {
    type: "play-item",
    itemType: "playlist",
    uri: "spotify:playlist:abc123",
    offsetUri: "spotify:track:def456",
    deviceId: "device-1",
  });

  expectInvalidInput(() =>
    parseSpotifyPlaybackCommand({
      type: "add-to-queue",
      uri: "spotify:show:abc123",
    })
  );
  expectInvalidInput(() =>
    parseSpotifyPlaybackCommand({ type: "volume", volumePercent: 101 })
  );
  expectInvalidInput(() => parseSpotifyPlaybackCommand(null));
});

test("remaining Spotify IPC payload parsers validate shape and bounds", () => {
  assert.equal(
    parseSpotifySearchQuery("  hades soundtrack  "),
    "hades soundtrack"
  );
  expectInvalidInput(() => parseSpotifySearchQuery({}));

  assert.deepEqual(parseSpotifyPlaylistItemsRequest("abc123", 50), {
    playlistId: "abc123",
    offset: 50,
  });
  expectInvalidInput(() => parseSpotifyPlaylistItemsRequest("../private", 0));
  expectInvalidInput(() => parseSpotifyPlaylistItemsRequest("abc123", -1));

  assert.deepEqual(parseSpotifySavedItemRequest("spotify:track:abc123", true), {
    uri: "spotify:track:abc123",
    saved: true,
  });
  expectInvalidInput(() =>
    parseSpotifySavedItemRequest("spotify:playlist:abc123", true)
  );
  expectInvalidInput(() =>
    parseSpotifySavedItemRequest("spotify:track:abc123", "yes")
  );

  assert.deepEqual(
    parseSpotifyLibraryUris([
      "spotify:track:abc123",
      "spotify:track:abc123",
      "spotify:episode:def456",
    ]),
    ["spotify:track:abc123", "spotify:episode:def456"]
  );
  expectInvalidInput(() => parseSpotifyLibraryUris("spotify:track:abc123"));
  expectInvalidInput(() =>
    parseSpotifyLibraryUris(["https://open.spotify.com/track/abc123"])
  );

  assert.equal(parseSpotifyControlAction("pause"), "pause");
  expectInvalidInput(() => parseSpotifyControlAction("stop"));
});
