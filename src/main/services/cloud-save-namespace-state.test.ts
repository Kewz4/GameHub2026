import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planCloudSaveAccountNamespace } from "./cloud-save-namespace-plan.js";
import {
  getCloudSaveNamespaceMigrationClaim,
  setCloudSaveNamespaceMigrationClaim,
} from "./cloud-save-namespace-claims.js";
import { CloudSaveNamespaceMutationQueue } from "./cloud-save-namespace-mutation-queue.js";

const legacyId = "6ce66cac-e77d-4c40-95c2-13954092fe15";
const accountId = "account-123";

describe("cloud save account namespace planning", () => {
  it("uses the account namespace on a fresh install", () => {
    assert.deepEqual(planCloudSaveAccountNamespace({}, accountId, accountId), {
      activeUserId: accountId,
      accountUserId: accountId,
      legacyUserIds: [],
      migrationPending: false,
    });
  });

  it("keeps a proven legacy namespace active until its copy succeeds", () => {
    assert.deepEqual(
      planCloudSaveAccountNamespace(
        { cloudSyncUserId: legacyId },
        accountId,
        accountId
      ),
      {
        activeUserId: legacyId,
        accountUserId: accountId,
        legacyUserIds: [legacyId],
        migrationPending: true,
      }
    );
  });

  it("resumes an interrupted migration", () => {
    assert.equal(
      planCloudSaveAccountNamespace(
        {
          cloudSyncUserId: legacyId,
          cloudSyncAccountUserId: accountId,
          cloudSyncLegacyUserIds: [legacyId],
          cloudSyncNamespaceMigrationPending: true,
        },
        accountId,
        null
      ).migrationPending,
      true
    );
  });

  it("does not claim an unproven UUID after account switching or sign-out", () => {
    assert.deepEqual(
      planCloudSaveAccountNamespace(
        { cloudSyncUserId: legacyId },
        accountId,
        null
      ),
      {
        activeUserId: accountId,
        accountUserId: accountId,
        legacyUserIds: [],
        migrationPending: false,
      }
    );
  });

  it("preserves a deferred A claim across A to B to A account switches", () => {
    const legacyB = "1ce66cac-e77d-4c40-95c2-13954092fe15";
    let claims = setCloudSaveNamespaceMigrationClaim({}, "account-a", {
      activeUserId: legacyId,
      legacyUserIds: [legacyId],
    });
    claims = setCloudSaveNamespaceMigrationClaim(claims, "account-b", {
      activeUserId: legacyB,
      legacyUserIds: [legacyB],
    });

    assert.deepEqual(getCloudSaveNamespaceMigrationClaim(claims, "account-a"), {
      activeUserId: legacyId,
      legacyUserIds: [legacyId],
    });
    assert.deepEqual(getCloudSaveNamespaceMigrationClaim(claims, "account-b"), {
      activeUserId: legacyB,
      legacyUserIds: [legacyB],
    });

    claims = setCloudSaveNamespaceMigrationClaim(claims, "account-b", null);
    assert.deepEqual(getCloudSaveNamespaceMigrationClaim(claims, "account-a"), {
      activeUserId: legacyId,
      legacyUserIds: [legacyId],
    });
  });

  it("rejects prototype-sensitive and malformed account claim keys", () => {
    const claims = setCloudSaveNamespaceMigrationClaim({}, "__proto__", {
      activeUserId: legacyId,
      legacyUserIds: [legacyId],
    });
    assert.equal(
      getCloudSaveNamespaceMigrationClaim(claims, "__proto__"),
      null
    );
    assert.equal(
      getCloudSaveNamespaceMigrationClaim(
        {
          ["bad\naccount"]: {
            activeUserId: legacyId,
            legacyUserIds: [legacyId],
          },
        },
        "bad\naccount"
      ),
      null
    );
  });

  it("serializes a paused A batch before B prepare so B is the final state", async () => {
    let releaseA!: () => void;
    const pausedA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const writes: string[] = [];
    const queue = new CloudSaveNamespaceMutationQueue();
    const operationA = queue.run(async () => {
      await pausedA;
      writes.push("account-a");
    });
    const operationB = queue.run(async () => {
      writes.push("account-b");
    });

    await Promise.resolve();
    assert.equal(writes.length, 0);
    releaseA();
    await Promise.all([operationA, operationB]);
    assert.deepEqual(writes, ["account-a", "account-b"]);
    assert.equal(writes.at(-1), "account-b");
  });
});
