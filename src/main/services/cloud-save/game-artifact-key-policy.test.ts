import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertEmulationSaveKeyForUser,
  assertGameArtifactKeyForUser,
  isEmulationSaveKeyForUser,
  isGameArtifactKeyForUser,
} from "./game-artifact-key-policy";

describe("game artifact key policy", () => {
  const userId = "account-a";

  it("accepts legacy save artifacts inside the current user's prefix", () => {
    assert.equal(
      isGameArtifactKeyForUser(
        `users/${userId}/saves/steam/1145360/1720000000000-deadbeef.tar`,
        userId
      ),
      true
    );
  });

  it("rejects shared, other-user, and path-like keys", () => {
    const invalidKeys = [
      "shared/exophase-cache.json",
      "users/account-b/saves/steam/1145360/1720000000000-deadbeef.tar",
      `users/${userId}/cloud-saves-v2/steam/1145360/control.json`,
      `users/${userId}/saves/steam/../shared/exophase-cache.json`,
      `users/${userId}/saves/steam/1145360\\malicious.tar`,
    ];

    for (const key of invalidKeys) {
      assert.equal(isGameArtifactKeyForUser(key, userId), false, key);
      assert.throws(
        () => assertGameArtifactKeyForUser(key, userId),
        /Invalid game artifact key/
      );
    }
  });

  it("rejects an unsafe or missing current-user namespace", () => {
    const key = "users/account-a/saves/steam/1145360/save.tar";
    assert.equal(isGameArtifactKeyForUser(key, "../account-a"), false);
    assert.equal(isGameArtifactKeyForUser(key, ""), false);
  });

  it("allows only the current user's emulation-save subtree", () => {
    const key =
      "users/account-a/emulation-saves/ps2/SLES-12345/1720000000000-save.psu";
    assert.equal(isEmulationSaveKeyForUser(key, userId), true);
    assert.doesNotThrow(() => assertEmulationSaveKeyForUser(key, userId));

    for (const invalidKey of [
      "users/account-b/emulation-saves/ps2/SLES-12345/save.psu",
      "users/account-a/cloud-saves-v2/steam/1/control.json",
      "users/account-a/emulation-saves/ps2/../cloud-saves-v2/control.json",
      "shared/exophase-cache.json",
    ]) {
      assert.equal(isEmulationSaveKeyForUser(invalidKey, userId), false);
      assert.throws(
        () => assertEmulationSaveKeyForUser(invalidKey, userId),
        /Invalid emulation save key/
      );
    }
  });
});
