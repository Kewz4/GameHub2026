import {
  cloudSaveCustomPathsSublevel,
  cloudSavePendingDeletionsSublevel,
  cloudSavePendingPostExitSublevel,
  cloudSaveSyncAnchorsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { UserPreferences } from "@types";
import { assertCloudSaveAccountSessionCurrent } from "./cloud-save/account-session";
import {
  planCloudSaveLocalNamespaceMigration,
  type CloudSaveLocalNamespaceEntry,
  type CloudSaveLocalNamespaceStore,
} from "./cloud-save-local-namespace-migration";
import {
  planCloudSaveAccountNamespace,
  uniqueCloudSaveLegacyIds,
} from "./cloud-save-namespace-plan";
import {
  getCloudSaveNamespaceMigrationClaim,
  isSafeCloudSaveAccountUserId,
  setCloudSaveNamespaceMigrationClaim,
} from "./cloud-save-namespace-claims";
import { CloudSaveNamespaceMutationQueue } from "./cloud-save-namespace-mutation-queue";

export { planCloudSaveAccountNamespace } from "./cloud-save-namespace-plan";

const readPreferences = () =>
  db
    .get<string, UserPreferences>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => ({}) as UserPreferences);

const namespaceStateMutations = new CloudSaveNamespaceMutationQueue();

const prepareCloudSaveAccountNamespaceInQueue = async (
  profileId: string,
  previouslyPersistedProfileId: string | null
) => {
  if (!isSafeCloudSaveAccountUserId(profileId)) {
    throw new Error("cloud_save_account_namespace_invalid");
  }
  const preferences = await readPreferences();
  const retainedClaim = getCloudSaveNamespaceMigrationClaim(
    preferences.cloudSyncNamespaceMigrationClaims,
    profileId
  );
  const plan = retainedClaim
    ? {
        activeUserId: retainedClaim.activeUserId,
        accountUserId: profileId,
        legacyUserIds: retainedClaim.legacyUserIds,
        migrationPending: true,
      }
    : planCloudSaveAccountNamespace(
        preferences,
        profileId,
        previouslyPersistedProfileId
      );
  const claims = setCloudSaveNamespaceMigrationClaim(
    preferences.cloudSyncNamespaceMigrationClaims,
    plan.accountUserId,
    plan.migrationPending
      ? {
          activeUserId: plan.activeUserId,
          legacyUserIds: plan.legacyUserIds,
        }
      : null
  );
  await db.put(
    levelKeys.userPreferences,
    {
      ...preferences,
      cloudSyncUserId: plan.activeUserId,
      cloudSyncAccountUserId: plan.accountUserId,
      cloudSyncLegacyUserIds: plan.legacyUserIds,
      cloudSyncNamespaceMigrationPending: plan.migrationPending,
      cloudSyncNamespaceMigrationClaims: claims,
    },
    { valueEncoding: "json" }
  );
  return plan;
};

export const prepareCloudSaveAccountNamespace = (
  profileId: string,
  previouslyPersistedProfileId: string | null
) =>
  namespaceStateMutations.run(() =>
    prepareCloudSaveAccountNamespaceInQueue(
      profileId,
      previouslyPersistedProfileId
    )
  );

export const getClaimableCloudSaveLegacyNamespaces = async () => {
  const pending = await getPendingCloudSaveNamespaceMigration();
  return pending?.legacyUserIds ?? [];
};

export const getPendingCloudSaveNamespaceMigration = async () => {
  const preferences = await readPreferences();
  const accountUserId = preferences.cloudSyncAccountUserId?.trim() ?? "";
  const retainedClaim = accountUserId
    ? getCloudSaveNamespaceMigrationClaim(
        preferences.cloudSyncNamespaceMigrationClaims,
        accountUserId
      )
    : null;
  const legacyUserIds = retainedClaim
    ? retainedClaim.legacyUserIds
    : preferences.cloudSyncNamespaceMigrationPending
      ? uniqueCloudSaveLegacyIds(
          preferences.cloudSyncLegacyUserIds ?? []
        ).filter((value) => value !== accountUserId)
      : [];
  return accountUserId && legacyUserIds.length
    ? { accountUserId, legacyUserIds }
    : null;
};

const completeCloudSaveNamespaceMigrationInQueue = async (
  accountUserId: string,
  migratedLegacyUserIds: readonly string[]
) => {
  if (!isSafeCloudSaveAccountUserId(accountUserId)) {
    throw new Error("cloud_save_account_namespace_invalid");
  }
  const preferences = await readPreferences();
  if (preferences.cloudSyncAccountUserId !== accountUserId) {
    throw new Error("cloud_save_namespace_account_changed");
  }
  const retainedClaim = getCloudSaveNamespaceMigrationClaim(
    preferences.cloudSyncNamespaceMigrationClaims,
    accountUserId
  );
  const migrated = new Set(migratedLegacyUserIds);
  const remaining = uniqueCloudSaveLegacyIds(
    retainedClaim?.legacyUserIds ?? preferences.cloudSyncLegacyUserIds ?? []
  ).filter((value) => !migrated.has(value));
  if (remaining.length > 0) {
    // A partial cutover could leave the active legacy namespace pointing at
    // state that has already been moved. R2 copies are immutable/idempotent, so
    // keep the old namespace fully active until every copy is ready.
    throw new Error("cloud_save_namespace_migration_incomplete");
  }

  const localEntries: CloudSaveLocalNamespaceEntry[] = [];
  const collect = async (
    store: CloudSaveLocalNamespaceStore,
    entries: AsyncIterable<[string, unknown]>
  ) => {
    for await (const [key, value] of entries) {
      assertCloudSaveAccountSessionCurrent();
      localEntries.push({ store, key, value });
    }
  };
  await Promise.all([
    collect("custom-paths", cloudSaveCustomPathsSublevel.iterator()),
    collect("sync-anchors", cloudSaveSyncAnchorsSublevel.iterator()),
    collect("pending-deletions", cloudSavePendingDeletionsSublevel.iterator()),
    collect("pending-post-exit", cloudSavePendingPostExitSublevel.iterator()),
  ]);

  const operations = planCloudSaveLocalNamespaceMigration(
    localEntries,
    migratedLegacyUserIds,
    accountUserId
  );
  const sublevels = {
    "custom-paths": cloudSaveCustomPathsSublevel,
    "sync-anchors": cloudSaveSyncAnchorsSublevel,
    "pending-deletions": cloudSavePendingDeletionsSublevel,
    "pending-post-exit": cloudSavePendingPostExitSublevel,
  } as const;
  const batch = db.batch();
  for (const operation of operations) {
    const sublevel = sublevels[operation.store];
    if (operation.type === "put") {
      batch.put(operation.key, operation.value, { sublevel });
    } else {
      batch.del(operation.key, { sublevel });
    }
  }
  batch.put<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      ...preferences,
      cloudSyncUserId: accountUserId,
      cloudSyncAccountUserId: accountUserId,
      cloudSyncLegacyUserIds: [],
      cloudSyncNamespaceMigrationPending: false,
      cloudSyncNamespaceMigrationClaims: setCloudSaveNamespaceMigrationClaim(
        preferences.cloudSyncNamespaceMigrationClaims,
        accountUserId,
        null
      ),
    },
    { valueEncoding: "json" }
  );
  assertCloudSaveAccountSessionCurrent();
  await batch.write();
  assertCloudSaveAccountSessionCurrent();
};

export const completeCloudSaveNamespaceMigration = (
  accountUserId: string,
  migratedLegacyUserIds: readonly string[]
) =>
  namespaceStateMutations.run(async () => {
    assertCloudSaveAccountSessionCurrent();
    return completeCloudSaveNamespaceMigrationInQueue(
      accountUserId,
      migratedLegacyUserIds
    );
  });
