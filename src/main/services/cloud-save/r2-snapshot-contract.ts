import type {
  BuildSnapshotAggregateHashInput,
  GameShop,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import {
  CLOUD_SAVE_HASH_PATTERN,
  validateRemoteSnapshotSummary,
  validateRestoreManifest,
} from "./cloud-save-contract";

export interface R2CloudSaveV2SnapshotMetadata {
  id: string;
  version: number;
  shop: GameShop;
  objectId: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  totalSizeBytes: number;
  aggregateHash: string;
  epoch: number;
}

/** Immutable manifest stored by the R2-backed Cloud Saves V2 engine. */
export interface R2CloudSaveV2SnapshotDocument {
  schemaVersion: 1;
  snapshot: R2CloudSaveV2SnapshotMetadata;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

export interface R2CloudSaveV2ControlDocument {
  schemaVersion: 1;
  revision: number;
  epoch: number;
  status: "active" | "deleting";
  deleteOperationId: string | null;
  snapshot: R2CloudSaveV2SnapshotMetadata | null;
  updatedAt: string;
}

export interface R2CloudSaveV2Head {
  control: R2CloudSaveV2ControlDocument;
  document: R2CloudSaveV2SnapshotDocument | null;
  etag: string | null;
}

export interface R2CloudSaveV2ExpectedIdentity {
  shop: GameShop;
  objectId: string;
  snapshotId?: string;
  version?: number;
}

export type BuildR2SnapshotAggregateHash = (
  input: BuildSnapshotAggregateHashInput
) => string;

const SNAPSHOT_DOCUMENT_KEYS = [
  "schemaVersion",
  "snapshot",
  "customPathRawPaths",
  "variants",
  "files",
] as const;
const LEGACY_SNAPSHOT_DOCUMENT_KEYS = [
  "schemaVersion",
  "snapshot",
  "variants",
  "files",
] as const;
const SNAPSHOT_METADATA_KEYS = [
  "id",
  "version",
  "shop",
  "objectId",
  "createdAt",
  "updatedAt",
  "fileCount",
  "totalSizeBytes",
  "aggregateHash",
  "epoch",
] as const;
const CONTROL_DOCUMENT_KEYS = [
  "schemaVersion",
  "revision",
  "epoch",
  "status",
  "deleteOperationId",
  "snapshot",
  "updatedAt",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[]
) => {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
};

const isSafeIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);

const isCanonicalIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
};

const invalidDocument = (kind: "control" | "snapshot") =>
  new Error(`cloud_save_invalid_r2_${kind}_document`);

/**
 * Stable JSON for immutable R2 documents. Object keys use a locale-independent
 * lexical order; array order remains semantically significant.
 */
export const canonicalizeR2CloudSaveJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeR2CloudSaveJson);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalizeR2CloudSaveJson(child)])
  );
};

export const serializeCanonicalR2CloudSaveJson = (value: unknown) =>
  JSON.stringify(canonicalizeR2CloudSaveJson(value));

const validateSnapshotMetadata = (
  value: unknown,
  expected: R2CloudSaveV2ExpectedIdentity
): R2CloudSaveV2SnapshotMetadata => {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_METADATA_KEYS)) {
    throw invalidDocument("snapshot");
  }

  if (
    !isSafeIdentifier(value.id) ||
    !isSafeIdentifier(value.objectId) ||
    !isNonNegativeSafeInteger(value.epoch) ||
    !isCanonicalIsoDate(value.createdAt) ||
    !isCanonicalIsoDate(value.updatedAt) ||
    value.createdAt > value.updatedAt
  ) {
    throw invalidDocument("snapshot");
  }

  const summary = validateRemoteSnapshotSummary({
    id: value.id,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    fileCount: value.fileCount,
    totalSizeBytes: value.totalSizeBytes,
    aggregateHash: value.aggregateHash,
  });
  const identity = validateRestoreManifest({
    snapshot: {
      id: value.id,
      version: value.version,
      shop: value.shop,
      objectId: value.objectId,
    },
    variants: [],
    files: [],
  }).snapshot;

  if (
    identity.shop !== expected.shop ||
    identity.objectId !== expected.objectId ||
    (expected.snapshotId !== undefined && summary.id !== expected.snapshotId) ||
    (expected.version !== undefined && summary.version !== expected.version)
  ) {
    throw invalidDocument("snapshot");
  }

  return {
    id: summary.id,
    version: summary.version,
    shop: identity.shop,
    objectId: identity.objectId,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    fileCount: summary.fileCount,
    totalSizeBytes: summary.totalSizeBytes,
    aggregateHash: summary.aggregateHash,
    epoch: value.epoch,
  };
};

export const validateR2CloudSaveV2SnapshotDocument = (
  value: unknown,
  expected: R2CloudSaveV2ExpectedIdentity,
  buildAggregateHash: BuildR2SnapshotAggregateHash
): R2CloudSaveV2SnapshotDocument => {
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, SNAPSHOT_DOCUMENT_KEYS) &&
      !hasExactKeys(value, LEGACY_SNAPSHOT_DOCUMENT_KEYS))
  ) {
    throw invalidDocument("snapshot");
  }
  if (value.schemaVersion !== 1) throw invalidDocument("snapshot");

  const snapshot = validateSnapshotMetadata(value.snapshot, expected);
  const manifest = validateRestoreManifest({
    snapshot: {
      id: snapshot.id,
      version: snapshot.version,
      shop: snapshot.shop,
      objectId: snapshot.objectId,
    },
    customPathRawPaths: value.customPathRawPaths,
    variants: value.variants,
    files: value.files,
  });
  const totalSizeBytes = manifest.files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  const aggregateHash = buildAggregateHash({
    variants: manifest.variants,
    files: manifest.files,
  });

  if (
    snapshot.fileCount !== manifest.files.length ||
    !Number.isSafeInteger(totalSizeBytes) ||
    snapshot.totalSizeBytes !== totalSizeBytes ||
    !CLOUD_SAVE_HASH_PATTERN.test(aggregateHash) ||
    snapshot.aggregateHash !== aggregateHash
  ) {
    throw invalidDocument("snapshot");
  }

  return {
    schemaVersion: 1,
    snapshot,
    customPathRawPaths: manifest.customPathRawPaths,
    variants: manifest.variants,
    files: manifest.files,
  };
};

export const validateR2CloudSaveV2ControlDocument = (
  value: unknown,
  expected: Pick<R2CloudSaveV2ExpectedIdentity, "shop" | "objectId">
): R2CloudSaveV2ControlDocument => {
  if (!isRecord(value) || !hasExactKeys(value, CONTROL_DOCUMENT_KEYS)) {
    throw invalidDocument("control");
  }
  if (
    value.schemaVersion !== 1 ||
    !isNonNegativeSafeInteger(value.epoch) ||
    !isNonNegativeSafeInteger(value.revision) ||
    value.revision < 1 ||
    !isCanonicalIsoDate(value.updatedAt) ||
    (value.status !== "active" && value.status !== "deleting")
  ) {
    throw invalidDocument("control");
  }

  const snapshot =
    value.snapshot === null
      ? null
      : validateSnapshotMetadata(value.snapshot, expected);
  const deleteOperationId =
    typeof value.deleteOperationId === "string"
      ? value.deleteOperationId
      : null;
  if (
    (snapshot !== null && snapshot.epoch !== value.epoch) ||
    (snapshot !== null && snapshot.updatedAt > value.updatedAt) ||
    (value.status === "active" &&
      (value.deleteOperationId !== null ||
        (snapshot !== null && snapshot.updatedAt !== value.updatedAt))) ||
    (value.status === "deleting" &&
      (!isSafeIdentifier(value.deleteOperationId) || snapshot !== null))
  ) {
    throw invalidDocument("control");
  }

  return {
    schemaVersion: 1,
    revision: value.revision,
    epoch: value.epoch,
    status: value.status,
    deleteOperationId,
    snapshot,
    updatedAt: value.updatedAt,
  };
};

export const assertR2CloudSaveV2HeadConsistency = (
  control: R2CloudSaveV2ControlDocument,
  document: R2CloudSaveV2SnapshotDocument | null
) => {
  if ((control.snapshot === null) !== (document === null)) {
    throw new Error("cloud_save_invalid_r2_head_pointer");
  }
  if (
    control.snapshot &&
    document &&
    serializeCanonicalR2CloudSaveJson(control.snapshot) !==
      serializeCanonicalR2CloudSaveJson(document.snapshot)
  ) {
    throw new Error("cloud_save_invalid_r2_head_pointer");
  }
};
