import { uniqueCloudSaveLegacyIds } from "./cloud-save-namespace-plan";

export interface CloudSaveNamespaceMigrationClaim {
  activeUserId: string;
  legacyUserIds: string[];
}

export type CloudSaveNamespaceMigrationClaims = Record<
  string,
  CloudSaveNamespaceMigrationClaim
>;

export const isSafeCloudSaveAccountUserId = (value: string) =>
  /^[a-zA-Z0-9._~-]{1,512}$/.test(value) &&
  value !== "__proto__" &&
  value !== "constructor" &&
  value !== "prototype";

export const normalizeCloudSaveNamespaceMigrationClaims = (
  value: unknown
): CloudSaveNamespaceMigrationClaims => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const claims = Object.create(null) as CloudSaveNamespaceMigrationClaims;
  for (const [accountUserId, candidate] of Object.entries(value)) {
    if (
      !isSafeCloudSaveAccountUserId(accountUserId) ||
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const legacyUserIds = uniqueCloudSaveLegacyIds(
      Array.isArray(record.legacyUserIds) ? record.legacyUserIds : []
    ).filter((legacyUserId) => legacyUserId !== accountUserId);
    const requestedActiveUserId =
      typeof record.activeUserId === "string" ? record.activeUserId.trim() : "";
    const activeUserId = legacyUserIds.includes(requestedActiveUserId)
      ? requestedActiveUserId
      : legacyUserIds[0];
    if (!activeUserId) continue;
    claims[accountUserId] = { activeUserId, legacyUserIds };
  }
  return claims;
};

export const getCloudSaveNamespaceMigrationClaim = (
  value: unknown,
  accountUserId: string
) =>
  isSafeCloudSaveAccountUserId(accountUserId)
    ? (normalizeCloudSaveNamespaceMigrationClaims(value)[accountUserId] ?? null)
    : null;

export const setCloudSaveNamespaceMigrationClaim = (
  value: unknown,
  accountUserId: string,
  claim: CloudSaveNamespaceMigrationClaim | null
) => {
  const claims = normalizeCloudSaveNamespaceMigrationClaims(value);
  if (!isSafeCloudSaveAccountUserId(accountUserId)) return claims;
  if (!claim) {
    delete claims[accountUserId];
    return claims;
  }
  const legacyUserIds = uniqueCloudSaveLegacyIds(claim.legacyUserIds).filter(
    (legacyUserId) => legacyUserId !== accountUserId
  );
  if (legacyUserIds.length === 0) {
    delete claims[accountUserId];
    return claims;
  }
  claims[accountUserId] = {
    activeUserId: legacyUserIds.includes(claim.activeUserId)
      ? claim.activeUserId
      : legacyUserIds[0],
    legacyUserIds,
  };
  return claims;
};
