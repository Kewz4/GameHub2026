import crypto from "node:crypto";
import path from "node:path";
import type {
  AchievementSouvenirRecord,
  GameShop,
  ProfileAchievementSouvenir,
} from "@types";

const MAX_SEGMENT_LENGTH = 96;
const OWNER_DIRECTORY_PREFIX = "owner-";
export const ACHIEVEMENT_SOUVENIR_ACCOUNTS_DIRECTORY = "accounts";
export const ACHIEVEMENT_SOUVENIR_QUARANTINE_DIRECTORY = ".unowned-legacy";

export const normalizeAchievementSouvenirName = (value: string) =>
  value.trim().toUpperCase();

const stableHash = (value: string) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

export const achievementSouvenirOwnerDirectory = (ownerId: string) => {
  if (!ownerId.trim() || ownerId.length > 512 || /\p{Cc}/u.test(ownerId)) {
    throw new Error("achievement_souvenir_owner_invalid");
  }

  // The account ID is intentionally not exposed in a user-visible path. The
  // full digest makes owner-directory collisions impractical while keeping
  // every path component platform-safe.
  return `${OWNER_DIRECTORY_PREFIX}${stableHash(ownerId)}`;
};

export const achievementSouvenirOwnerRoot = (root: string, ownerId: string) =>
  path.join(
    root,
    ACHIEVEMENT_SOUVENIR_ACCOUNTS_DIRECTORY,
    achievementSouvenirOwnerDirectory(ownerId)
  );

export const achievementSouvenirRecordKey = (
  ownerId: string,
  shop: GameShop,
  objectId: string,
  achievementName: string
) =>
  JSON.stringify([
    ownerId,
    shop,
    objectId,
    normalizeAchievementSouvenirName(achievementName),
  ]);

export const achievementSouvenirR2Key = (
  ownerId: string,
  shop: GameShop,
  objectId: string,
  achievementName: string
) =>
  `users/${encodeURIComponent(ownerId)}/achievement-souvenirs/${encodeURIComponent(
    shop
  )}/${encodeURIComponent(objectId)}/${stableHash(
    normalizeAchievementSouvenirName(achievementName)
  )}.jpeg`;

const sanitizePathSegment = (value: string) => {
  const sanitized = Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point > 31 && point !== 127;
    })
    .join("")
    .replaceAll(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/u, "")
    .trim()
    .slice(0, MAX_SEGMENT_LENGTH);

  if (!sanitized) return "unknown";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(sanitized)
    ? `_${sanitized}`
    : sanitized;
};

export const achievementSouvenirScreenshotPath = (
  root: string,
  input: {
    ownerId: string;
    shop: GameShop;
    objectId: string;
    gameTitle: string;
    achievementName: string;
    achievementDisplayName: string;
  }
) => {
  const gameHash = stableHash(`${input.shop}\0${input.objectId}`).slice(0, 12);
  const achievementHash = stableHash(
    normalizeAchievementSouvenirName(input.achievementName)
  ).slice(0, 16);

  return path.join(
    achievementSouvenirOwnerRoot(root, input.ownerId),
    `${sanitizePathSegment(input.gameTitle)}-${gameHash}`,
    `${sanitizePathSegment(input.achievementDisplayName)}-${achievementHash}.jpeg`
  );
};

export const isPathInside = (root: string, candidate: string) => {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
};

export const isOwnedAchievementSouvenirPath = (
  root: string,
  ownerId: string,
  candidate: string
) => isPathInside(achievementSouvenirOwnerRoot(root, ownerId), candidate);

export const isUnownedLegacyAchievementSouvenirPath = (
  root: string,
  candidate: string
) => {
  if (!isPathInside(root, candidate)) return false;

  const accountsRoot = path.join(root, ACHIEVEMENT_SOUVENIR_ACCOUNTS_DIRECTORY);
  const quarantineRoot = path.join(
    root,
    ACHIEVEMENT_SOUVENIR_QUARANTINE_DIRECTORY
  );
  return (
    !isPathInside(accountsRoot, candidate) &&
    !isPathInside(quarantineRoot, candidate)
  );
};

export const selectAchievementSouvenirCleanupCandidates = (
  screenshots: readonly { path: string; modifiedAt: number }[],
  protectedPaths: readonly string[],
  maximumStoredScreenshots: number
) => {
  const protectedFiles = new Set(
    protectedPaths.map((filePath) => path.resolve(filePath))
  );
  const unprotectedCapacity = Math.max(
    0,
    maximumStoredScreenshots - protectedFiles.size
  );
  return screenshots
    .filter((screenshot) => !protectedFiles.has(path.resolve(screenshot.path)))
    .toSorted((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(unprotectedCapacity);
};

export const localAchievementSouvenirUrl = (filePath: string) =>
  `local:${filePath.replaceAll("\\", "/")}`;

export const profileAchievementSouvenirFromRecord = (
  record: AchievementSouvenirRecord,
  imageUrl: string
): ProfileAchievementSouvenir => ({
  ownerId: record.ownerId,
  shop: record.shop,
  objectId: record.objectId,
  achievementName: record.achievementName,
  achievementDisplayName: record.achievementDisplayName,
  achievementDescription: record.achievementDescription ?? null,
  achievementIconUrl: record.achievementIconUrl ?? null,
  gameTitle: record.gameTitle,
  gameIconUrl: record.gameIconUrl,
  imageUrl,
  unlockTime: record.unlockTime,
});

export const isAchievementSouvenirRecord = (
  value: unknown
): value is AchievementSouvenirRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AchievementSouvenirRecord>;
  return Boolean(
    record.schemaVersion === 1 &&
      typeof record.ownerId === "string" &&
      record.ownerId.length > 0 &&
      record.ownerId.length <= 512 &&
      typeof record.shop === "string" &&
      typeof record.objectId === "string" &&
      record.objectId.length > 0 &&
      record.objectId.length <= 1_024 &&
      typeof record.achievementName === "string" &&
      normalizeAchievementSouvenirName(record.achievementName).length > 0 &&
      typeof record.achievementDisplayName === "string" &&
      (record.achievementDescription === undefined ||
        record.achievementDescription === null ||
        typeof record.achievementDescription === "string") &&
      (record.achievementIconUrl === undefined ||
        record.achievementIconUrl === null ||
        typeof record.achievementIconUrl === "string") &&
      typeof record.gameTitle === "string" &&
      (record.gameIconUrl === null || typeof record.gameIconUrl === "string") &&
      Number.isFinite(record.unlockTime) &&
      (record.localPath === null || typeof record.localPath === "string") &&
      (record.r2Key === null || typeof record.r2Key === "string") &&
      ["local", "synced", "pending-delete"].includes(record.status ?? "") &&
      Number.isFinite(record.updatedAt)
  );
};

export const mergeAchievementSouvenirRecords = (
  local: AchievementSouvenirRecord | null,
  remote: AchievementSouvenirRecord
): AchievementSouvenirRecord => {
  if (!local) return remote;
  if (local.status === "pending-delete") return local;

  return {
    ...remote,
    ...local,
    localPath: local.localPath,
    r2Key: remote.r2Key ?? local.r2Key,
    status: remote.r2Key ? "synced" : local.status,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
};
