import assert from "node:assert/strict";
import test from "node:test";

import { shouldRunV2AutomaticCloudSave } from "../../src/main/services/cloud-save/automatic-sync-mode.ts";
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

test("automatic cloud-save lifecycle routes only V2 for every shop", () => {
  const modes: CloudSaveAutomaticSyncMode[] = ["disabled", "legacy", "v2"];

  for (const shop of shops) {
    for (const mode of modes) {
      assert.equal(
        shouldRunV2AutomaticCloudSave(mode),
        mode === "v2",
        `${shop}:${mode}`
      );
    }
  }
});
