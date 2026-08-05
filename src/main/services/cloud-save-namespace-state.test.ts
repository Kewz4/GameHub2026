import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planCloudSaveAccountNamespace } from "./cloud-save-namespace-plan.js";

const legacyId = "6ce66cac-e77d-4c40-95c2-13954092fe15";
const accountId = "account-123";

describe("cloud save account namespace planning", () => {
  it("uses the account namespace on a fresh install", () => {
    assert.deepEqual(
      planCloudSaveAccountNamespace({}, accountId, accountId),
      {
        activeUserId: accountId,
        accountUserId: accountId,
        legacyUserIds: [],
        migrationPending: false,
      }
    );
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
});
