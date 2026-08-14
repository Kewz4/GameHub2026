import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_GLOBAL_TRACKERS,
  MAX_TRACKER_LIST_TEXT_LENGTH,
  MAX_TRACKER_URL_LENGTH,
  TrackerListValidationError,
  filterValidTrackerUrls,
  isValidTrackerUrl,
  parseTrackerList,
  resolveConfiguredGlobalTrackers,
  validateAndNormalizeTrackerUrls,
} from "./tracker-list";

describe("global tracker URL validation", () => {
  it("accepts supported tracker protocols and preserves passkey queries", () => {
    for (const url of [
      "http://tracker.example/announce",
      "https://tracker.example:443/announce?passkey=abc123",
      "udp://tracker.example:6969/announce",
      "ws://tracker.example/announce",
      "wss://tracker.example/announce",
    ]) {
      assert.equal(isValidTrackerUrl(url), true, url);
    }
  });

  it("rejects unsupported, hostless, fragmented, whitespace, and oversized URLs", () => {
    for (const url of [
      "ftp://tracker.example/announce",
      "file:///etc/passwd",
      "http:///announce",
      "udp://",
      "https://tracker.example/a b",
      "https://tracker.example/announce#fragment",
      `https://tracker.example/${"a".repeat(MAX_TRACKER_URL_LENGTH)}`,
    ]) {
      assert.equal(isValidTrackerUrl(url), false, url.slice(0, 80));
    }
  });

  it("trims, ignores comments, and deduplicates newline input", () => {
    assert.deepEqual(
      parseTrackerList(
        "\n# private list\n udp://one.example/announce \r\n" +
          "https://two.example/announce\nudp://one.example/announce\n"
      ),
      ["udp://one.example/announce", "https://two.example/announce"]
    );
  });

  it("enforces input, count, and aggregate size limits", () => {
    assert.throws(
      () => parseTrackerList("x".repeat(MAX_TRACKER_LIST_TEXT_LENGTH + 1)),
      (error: unknown) =>
        error instanceof TrackerListValidationError &&
        error.code === "tracker_list_too_large"
    );

    assert.throws(
      () =>
        validateAndNormalizeTrackerUrls(
          Array.from(
            { length: MAX_GLOBAL_TRACKERS + 1 },
            (_, index) => `udp://tracker-${index}.example/announce`
          )
        ),
      (error: unknown) =>
        error instanceof TrackerListValidationError &&
        error.code === "too_many_trackers"
    );
  });

  it("fails closed on invalid persistence input but filters corrupted legacy records", () => {
    assert.throws(
      () =>
        validateAndNormalizeTrackerUrls([
          "udp://valid.example/announce",
          "javascript:alert(1)",
        ]),
      (error: unknown) =>
        error instanceof TrackerListValidationError &&
        error.code === "invalid_tracker_url"
    );

    assert.deepEqual(
      filterValidTrackerUrls([
        "udp://valid.example/announce",
        "javascript:alert(1)",
        "udp://valid.example/announce",
      ]),
      ["udp://valid.example/announce"]
    );
  });

  it("returns configured trackers only when appending is explicitly enabled", () => {
    const preferences = {
      globalTrackers: [" udp://valid.example/announce "],
      appendGlobalTrackers: true,
    };

    assert.deepEqual(resolveConfiguredGlobalTrackers(preferences), [
      "udp://valid.example/announce",
    ]);
    assert.deepEqual(
      resolveConfiguredGlobalTrackers({
        ...preferences,
        appendGlobalTrackers: false,
      }),
      []
    );
  });
});
