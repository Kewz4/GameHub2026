import {
  cloudSaveCustomPathsSublevel,
  cloudSavePendingDeletionsSublevel,
  cloudSaveSyncAnchorsSublevel,
  db,
  levelKeys,
} from "@main/level";
import type { UserPreferences } from "@types";
import {
  planCloudSaveLocalNamespaceMigration,
  type CloudSaveLocalNamespaceEntry,
  type CloudSaveLocalNamespaceStore,
} from "./cloud-save-local-namespace-migration";
import {
  planCloudSaveAccountNamespace,
  uniqueCloudSaveLegacyIds,
} from "./cloud-save-namespace-plan";

export { planCloudSaveAccountNamespace } from "./cloud-save-namespace-plan";

const readPreferences = () =>
  db
    .get<string, UserPreferences>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => ({}) as UserPreferences);

export const prepareCloudSaveAccountNamespace = async (
  profileId: string,
  previouslyPersistedProfileId: string | null
) => {
  const preferences = await readPreferences();
  const plan = planCloudSaveAccountNamespace(
    preferences,
    profileId,
    previouslyPersistedProfileId
  );
  await db.put(
    levelKeys.userPreferences,
    {
      ...preferences,
      cloudSyncUserId: plan.activeUserId,
      cloudSyncAccountUserId: plan.accountUserId,
      cloudSyncLegacyUserIds: plan.legacyUserIds,
      cloudSyncNamespaceMigrationPending: plan.migrationPending,
    },
    { valueEncoding: "json" }
  );
  return plan;
};

export const getClaimableCloudSaveLegacyNamespaces = async () => {
  const preferences = await readPreferences();
  if (!preferences.cloudSyncNamespaceMigrationPending) return [];
  if (!preferences.cloudSyncAccountUserId) return [];
  return uniqueCloudSaveLegacyIds(
    preferences.cloudSyncLegacyUserIds ?? []
  ).filter((value) => value !== preferences.cloudSyncAccountUserId);
};

export const getPendingCloudSaveNamespaceMigration = async () => {
  const preferences = await readPreferences();
  const accountUserId = preferences.cloudSyncAccountUserId?.trim() ?? "";
  const legacyUserIds = preferences.cloudSyncNamespaceMigrationPending
    ? uniqueCloudSaveLegacyIds(preferences.cloudSyncLegacyUserIds ?? []).filter(
        (value) => value !== accountUserId
      )
    : [];
  return accountUserId && legacyUserIds.length
    ? { accountUserId, legacyUserIds }
    : null;
};

export const completeCloudSaveNamespaceMigration = async (
  accountUserId: string,
  migratedLegacyUserIds: readonly string[]
) => {
  const preferences = await readPreferences();
  if (preferences.cloudSyncAccountUserId !== accountUserId) {
    throw new Error("cloud_save_namespace_account_changed");
  }
  const migrated = new Set(migratedLegacyUserIds);
  const remaining = uniqueCloudSaveLegacyIds(
    preferences.cloudSyncLegacyUserIds ?? []
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
      localEntries.push({ store, key, value });
    }
  };
  await Promise.all([
    collect("custom-paths", cloudSaveCustomPathsSublevel.iterator()),
    collect("sync-anchors", cloudSaveSyncAnchorsSublevel.iterator()),
    collect("pending-deletions", cloudSavePendingDeletionsSublevel.iterator()),
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
    },
    { valueEncoding: "json" }
  );
  await batch.write();
};
