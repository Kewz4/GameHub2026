import type { UserPreferences } from "@types";

export const LEGACY_CLOUD_SAVE_NAMESPACE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LEGACY_NAMESPACES = 4;

export interface CloudSaveNamespacePlan {
  activeUserId: string;
  accountUserId: string;
  legacyUserIds: string[];
  migrationPending: boolean;
}

export const uniqueCloudSaveLegacyIds = (values: readonly unknown[]) =>
  [...new Set(values)]
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        LEGACY_CLOUD_SAVE_NAMESPACE_PATTERN.test(value)
    )
    .slice(0, MAX_LEGACY_NAMESPACES);

/**
 * Decide how an authenticated installation should address R2.
 *
 * A legacy random UUID is claimable only when the locally persisted user from
 * the old installation matches the freshly authenticated profile. That keeps
 * account switching from silently transferring one account's namespace to a
 * different account. While a copy is pending, the old namespace remains the
 * active one so a network/deployment failure cannot strand existing saves.
 */
export const planCloudSaveAccountNamespace = (
  preferences: Pick<
    UserPreferences,
    | "cloudSyncUserId"
    | "cloudSyncAccountUserId"
    | "cloudSyncLegacyUserIds"
    | "cloudSyncNamespaceMigrationPending"
  >,
  profileId: string,
  previouslyPersistedProfileId: string | null
): CloudSaveNamespacePlan => {
  const activeUserId = preferences.cloudSyncUserId?.trim() ?? "";
  const recordedAccountId = preferences.cloudSyncAccountUserId?.trim() ?? "";
  const recordedLegacyIds = uniqueCloudSaveLegacyIds(
    preferences.cloudSyncLegacyUserIds ?? []
  );

  if (activeUserId === profileId) {
    return {
      activeUserId: profileId,
      accountUserId: profileId,
      legacyUserIds: [],
      migrationPending: false,
    };
  }

  const canResumeRecordedMigration =
    recordedAccountId === profileId &&
    LEGACY_CLOUD_SAVE_NAMESPACE_PATTERN.test(activeUserId) &&
    recordedLegacyIds.includes(activeUserId);
  const canClaimLegacyInstallNamespace =
    !recordedAccountId &&
    previouslyPersistedProfileId === profileId &&
    LEGACY_CLOUD_SAVE_NAMESPACE_PATTERN.test(activeUserId);

  if (canResumeRecordedMigration || canClaimLegacyInstallNamespace) {
    const legacyUserIds = uniqueCloudSaveLegacyIds([
      activeUserId,
      ...recordedLegacyIds,
    ]).filter((value) => value !== profileId);
    return {
      activeUserId,
      accountUserId: profileId,
      legacyUserIds,
      migrationPending: legacyUserIds.length > 0,
    };
  }

  return {
    activeUserId: profileId,
    accountUserId: profileId,
    legacyUserIds: [],
    migrationPending: false,
  };
};
