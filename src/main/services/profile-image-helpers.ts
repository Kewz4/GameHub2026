import { fileURLToPath } from "node:url";

export type ProfileImagePreferenceKind = "avatar" | "banner";

export interface ProfileImagePreferenceSnapshot {
  localProfileImageUrl?: string | null;
  localBackgroundImageUrl?: string | null;
  localProfileImageUserId?: string | null;
  localBackgroundImageUserId?: string | null;
  profileAvatarRemoved?: boolean;
  profileBannerRemoved?: boolean;
  cloudSyncAccountUserId?: string | null;
  profileImageOwnershipMigrationVersion?: number;
}

export interface ResolvedOwnedProfileImagePreference {
  isOwned: boolean;
  removed: boolean;
  url: string | null;
}

export interface ProfileImageObjectSummary {
  Key?: string;
  ETag?: string;
  LastModified?: Date;
  Size?: number;
}

function profileImageName(key: string, prefix: string) {
  return key.startsWith(prefix) ? key.slice(prefix.length) : "";
}

/**
 * R2 can contain an older image with a different extension after a user
 * replaces a PNG with a WebP (or vice versa). Always pick the newest exact
 * kind instead of relying on the bucket's lexicographical listing order.
 */
export function selectLatestProfileImageObject<
  T extends ProfileImageObjectSummary,
>(objects: readonly T[], prefix: string, kind: string): T | null {
  const expectedPrefix = `${kind}.`;

  return (
    objects
      .filter((object) => {
        if (!object.Key) return false;
        const name = profileImageName(object.Key, prefix);
        const extension = name.slice(expectedPrefix.length);
        return (
          name.startsWith(expectedPrefix) &&
          extension.length > 0 &&
          !extension.includes("/") &&
          !extension.includes(".")
        );
      })
      .sort((left, right) => {
        const modifiedDelta =
          (right.LastModified?.getTime() ?? 0) -
          (left.LastModified?.getTime() ?? 0);
        if (modifiedDelta !== 0) return modifiedDelta;
        return (right.Key ?? "").localeCompare(left.Key ?? "");
      })[0] ?? null
  );
}

export function sanitizeProfileImageCacheComponent(value: string) {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized || "image";
}

function normalizeProfileImageOwnerId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 512 || /\p{Cc}/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function getPreferenceFields(
  preferences: ProfileImagePreferenceSnapshot,
  kind: ProfileImagePreferenceKind
) {
  if (kind === "avatar") {
    return {
      value: preferences.localProfileImageUrl,
      ownerId: preferences.localProfileImageUserId,
      removed: preferences.profileAvatarRemoved,
      ownerField: "localProfileImageUserId" as const,
    };
  }

  return {
    value: preferences.localBackgroundImageUrl,
    ownerId: preferences.localBackgroundImageUserId,
    removed: preferences.profileBannerRemoved,
    ownerField: "localBackgroundImageUserId" as const,
  };
}

/**
 * Older builds could persist a raw private R2 object key. It is not a renderer
 * URL, but its namespace is strong enough provenance to migrate ownership.
 */
export function inferProfileImageOwnerFromPersistedValue(
  value: string | null | undefined
) {
  if (!value) return null;

  const normalized = value.replace(/^local:/i, "").replace(/\\/g, "/");
  // A URL whose pathname merely resembles an R2 key is not provenance: it
  // could be any server-controlled or user-supplied URL. Only the raw private
  // object-key shape written by older GameHub R2 builds is safe to adopt.
  if (!/^users\//i.test(normalized)) return null;

  const match = normalized.match(/^users\/([^/]+)\/images\//i);
  if (!match?.[1]) return null;

  try {
    return normalizeProfileImageOwnerId(decodeURIComponent(match[1]));
  } catch {
    return normalizeProfileImageOwnerId(match[1]);
  }
}

/**
 * Plan a one-time migration using only ownership embedded in the image value.
 * Unknown ownerless values remain deliberately unclaimed so they cannot leak
 * from account A into a later account B session.
 */
export function planLegacyProfileImageOwnerMigration(
  preferences: ProfileImagePreferenceSnapshot
): Partial<ProfileImagePreferenceSnapshot> {
  if ((preferences.profileImageOwnershipMigrationVersion ?? 0) >= 1) {
    return {};
  }

  const migration: Partial<ProfileImagePreferenceSnapshot> = {
    // Even an unknown owner must be marked as examined. Otherwise a later
    // account switch could rewrite cloudSyncAccountUserId and make the same
    // ownerless value look attributable to the wrong account.
    profileImageOwnershipMigrationVersion: 1,
  };

  for (const kind of ["avatar", "banner"] as const) {
    const fields = getPreferenceFields(preferences, kind);
    if (normalizeProfileImageOwnerId(fields.ownerId)) continue;

    const hasLegacyState = fields.value != null || fields.removed !== undefined;
    if (!hasLegacyState) continue;

    // cloudSyncAccountUserId describes the current cloud-save namespace, not
    // necessarily the account that wrote an older global profile path. Only an
    // owner-encoded image value is safe to adopt automatically.
    const inferredOwnerId = inferProfileImageOwnerFromPersistedValue(
      fields.value
    );
    if (inferredOwnerId) {
      migration[fields.ownerField] = inferredOwnerId;
    }
  }

  return migration;
}

/** Resolve a local path/tombstone only for the account that created it. */
export function resolveOwnedProfileImagePreference(
  preferences: ProfileImagePreferenceSnapshot,
  kind: ProfileImagePreferenceKind,
  expectedUserId: string,
  fileExists: (filePath: string) => boolean
): ResolvedOwnedProfileImagePreference {
  const fields = getPreferenceFields(preferences, kind);
  const ownerId = normalizeProfileImageOwnerId(fields.ownerId);
  const normalizedExpectedUserId = normalizeProfileImageOwnerId(expectedUserId);
  const isOwned = Boolean(
    ownerId && normalizedExpectedUserId && ownerId === normalizedExpectedUserId
  );

  if (!isOwned) {
    return { isOwned: false, removed: false, url: null };
  }

  if (fields.removed) {
    return { isOwned: true, removed: true, url: null };
  }

  return {
    isOwned: true,
    removed: false,
    url: resolvePersistedProfileImageUrl(fields.value, fileExists),
  };
}

export function getProfileImageCacheFileName(
  hydraUserId: string,
  kind: string,
  object: ProfileImageObjectSummary,
  extension: string
) {
  const version =
    object.ETag?.replaceAll('"', "") ||
    `${object.LastModified?.getTime() ?? 0}-${object.Size ?? 0}`;

  return `${sanitizeProfileImageCacheComponent(
    hydraUserId
  )}-${sanitizeProfileImageCacheComponent(kind)}-${sanitizeProfileImageCacheComponent(
    version
  )}.${sanitizeProfileImageCacheComponent(extension)}`;
}

/** Convert a persisted local preference into a renderer-safe URL. */
export function resolvePersistedProfileImageUrl(
  value: string | null | undefined,
  fileExists: (filePath: string) => boolean
): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  let filePath = value;
  if (filePath.startsWith("local:")) {
    filePath = filePath.slice("local:".length);
  } else if (filePath.startsWith("file:")) {
    try {
      filePath = fileURLToPath(filePath);
    } catch {
      return null;
    }
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  if (!fileExists(normalizedPath)) return null;
  return `local:${normalizedPath}`;
}
