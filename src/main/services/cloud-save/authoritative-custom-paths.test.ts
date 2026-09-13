import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAuthoritativeCloudSaveCustomPathRawPaths } from "./authoritative-custom-paths.js";

describe("authoritative Cloud Save custom paths", () => {
  it("includes an empty manual mapper rule and excludes emulator identities", () => {
    const manualPath = "<custom><windows><winDocuments>/Mapped";
    assert.deepEqual(
      getAuthoritativeCloudSaveCustomPathRawPaths(
        { ready: [], unresolved: [] },
        [
          {
            ruleId: "manual",
            kind: "dir",
            rawPath: manualPath,
            source: "custom",
            tags: ["save"],
            when: [{ os: "windows" }],
          },
          {
            ruleId: "emulator",
            kind: "dir",
            rawPath: "<gamehubEmulator>/cemu/save",
            source: "custom",
            tags: ["save"],
            when: [{ os: "windows" }],
          },
        ]
      ),
      [manualPath]
    );
  });
});
