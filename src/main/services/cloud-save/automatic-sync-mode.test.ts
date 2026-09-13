import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCloudSaveAutomaticSyncStateForMode,
  getNextCloudSaveAutomaticSyncMode,
  resolveCloudSaveAutomaticSyncMode,
  resolveStoredCloudSaveAutomaticSyncMode,
  resolveStoredCloudSaveAutomaticSyncModeForShop,
  shouldRunV2AutomaticCloudSave,
} from "./automatic-sync-mode.js";

describe("cloud save automatic sync mode", () => {
  it("prefers V2 when both modes are enabled", () => {
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: true,
        v2Enabled: true,
      }),
      "v2"
    );
  });

  it("can decode a migration-only legacy flag shape", () => {
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: true,
        v2Enabled: false,
      }),
      "legacy"
    );
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: false,
        v2Enabled: true,
      }),
      "v2"
    );
  });

  it("allows both implementations to be disabled", () => {
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: false,
        v2Enabled: false,
      }),
      "disabled"
    );
  });

  it("treats an absent V2 setting as the day-one V2 default", () => {
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(false, undefined),
      "v2"
    );
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(true, undefined),
      "v2"
    );
    assert.equal(resolveStoredCloudSaveAutomaticSyncMode(true, true), "v2");
  });

  it("preserves an explicit V2 opt-out even when legacy was enabled", () => {
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(true, false),
      "disabled"
    );
    assert.equal(
      resolveStoredCloudSaveAutomaticSyncMode(false, false),
      "disabled"
    );
  });

  it("defaults every supported shop to V2 and honors explicit opt-out", () => {
    const shops = [
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
    ] as const;

    for (const shop of shops) {
      assert.equal(
        resolveStoredCloudSaveAutomaticSyncModeForShop(shop, true, undefined),
        "v2"
      );
      assert.equal(
        resolveStoredCloudSaveAutomaticSyncModeForShop(shop, false, false),
        "disabled"
      );
    }
  });

  it("keeps migration-only legacy serialization separate from V2", () => {
    assert.deepEqual(getCloudSaveAutomaticSyncStateForMode("legacy"), {
      legacyEnabled: true,
      v2Enabled: false,
    });
  });

  it("enabling V2 disables legacy", () => {
    assert.equal(getNextCloudSaveAutomaticSyncMode("legacy", "v2", true), "v2");
    assert.deepEqual(getCloudSaveAutomaticSyncStateForMode("v2"), {
      legacyEnabled: false,
      v2Enabled: true,
    });
  });

  it("disabling V2 preserves a migration-only legacy marker", () => {
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("legacy", "v2", false),
      "legacy"
    );
  });

  it("disabling the selected mode leaves both disabled", () => {
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("v2", "v2", false),
      "disabled"
    );
  });

  it("routes lifecycle work only for V2", () => {
    for (const mode of ["disabled", "legacy", "v2"] as const) {
      const v2Runs = shouldRunV2AutomaticCloudSave(mode);
      assert.equal(v2Runs, mode === "v2");
    }
  });
});
