import assert from "node:assert/strict";
import test from "node:test";

import {
  getCloudSaveAutomaticSyncStateForMode,
  shouldRunLegacyAutomaticCloudSave,
  shouldRunV2AutomaticCloudSave,
} from "../../src/main/services/cloud-save/automatic-sync-mode.ts";
import type {
  CloudSaveAutomaticSyncMode,
  GameShop,
} from "../../src/types/index.ts";

const shops: GameShop[] = [
  "steam",
  "epic",
  "gog",
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "launchbox",
  "custom",
];

test("automatic cloud-save lifecycle selects at most one backend for every shop", () => {
  const modes: CloudSaveAutomaticSyncMode[] = ["disabled", "legacy", "v2"];

  for (const shop of shops) {
    for (const mode of modes) {
      const selected = [
        shouldRunLegacyAutomaticCloudSave(mode) ? "legacy" : null,
        shouldRunV2AutomaticCloudSave(mode) ? "v2" : null,
      ].filter(Boolean);

      assert.equal(
        selected.length,
        mode === "disabled" ? 0 : 1,
        `${shop}:${mode}`
      );
      assert.deepEqual(getCloudSaveAutomaticSyncStateForMode(mode), {
        legacyEnabled: mode === "legacy",
        v2Enabled: mode === "v2",
      });
    }
  }
});
