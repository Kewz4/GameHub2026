import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGlobalTrackerPreferencePatch } from "./global-tracker-preferences";

describe("global tracker preference persistence", () => {
  it("normalizes a bounded tracker list while preserving unrelated preferences", () => {
    assert.deepEqual(
      normalizeGlobalTrackerPreferencePatch({
        themeMode: "dark",
        globalTrackers: [
          " udp://tracker.example:6969/announce ",
          "udp://tracker.example:6969/announce",
        ],
        appendGlobalTrackers: true,
      }),
      {
        themeMode: "dark",
        globalTrackers: ["udp://tracker.example:6969/announce"],
        appendGlobalTrackers: true,
      }
    );
  });

  it("rejects malformed tracker and toggle values at the IPC boundary", () => {
    assert.throws(() =>
      normalizeGlobalTrackerPreferencePatch({
        globalTrackers: ["file:///etc/passwd"],
      })
    );

    assert.throws(() =>
      normalizeGlobalTrackerPreferencePatch({
        appendGlobalTrackers: "yes",
      } as never)
    );
  });
});
