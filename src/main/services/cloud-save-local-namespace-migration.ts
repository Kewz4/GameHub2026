import { isDeepStrictEqual } from "node:util";

export type CloudSaveLocalNamespaceStore =
  | "custom-paths"
  | "sync-anchors"
  | "pending-deletions"
  | "pending-post-exit";

export interface CloudSaveLocalNamespaceEntry {
  store: CloudSaveLocalNamespaceStore;
  key: string;
  value: unknown;
}

export type CloudSaveLocalNamespaceMigrationOperation =
  | (CloudSaveLocalNamespaceEntry & { type: "put" })
  | (Pick<CloudSaveLocalNamespaceEntry, "store" | "key"> & { type: "del" });

const parseScopedKey = (key: string) => {
  let parts: unknown;
  try {
    parts = JSON.parse(key);
  } catch {
    return null;
  }

  if (
    !Array.isArray(parts) ||
    (parts.length !== 3 && parts.length !== 5) ||
    typeof parts[0] !== "string" ||
    typeof parts[1] !== "string" ||
    typeof parts[2] !== "string" ||
    (parts.length === 5 &&
      (parts[3] !== "environment" || typeof parts[4] !== "string"))
  ) {
    return null;
  }

  return parts as [string, string, string, ...unknown[]];
};

const entryId = (store: CloudSaveLocalNamespaceStore, key: string) =>
  `${store}\0${key}`;

/**
 * Build an all-or-nothing migration plan for LevelDB records keyed by the old
 * anonymous Cloud Save namespace. Existing account records are never silently
 * overwritten; equal values are deduplicated and differing values stop the
 * namespace cutover before any batch is written.
 */
export const planCloudSaveLocalNamespaceMigration = (
  entries: readonly CloudSaveLocalNamespaceEntry[],
  legacyUserIds: readonly string[],
  accountUserId: string
): CloudSaveLocalNamespaceMigrationOperation[] => {
  const legacyIds = new Set(legacyUserIds);
  const destinations = new Map(
    entries.map((entry) => [entryId(entry.store, entry.key), entry.value])
  );
  const puts = new Map<string, CloudSaveLocalNamespaceEntry>();
  const deletions: CloudSaveLocalNamespaceMigrationOperation[] = [];

  for (const entry of entries) {
    const parts = parseScopedKey(entry.key);
    if (!parts || !legacyIds.has(parts[0])) continue;

    const destinationKey = JSON.stringify([accountUserId, ...parts.slice(1)]);
    const destinationId = entryId(entry.store, destinationKey);
    const existing = destinations.get(destinationId);
    if (destinations.has(destinationId)) {
      if (!isDeepStrictEqual(existing, entry.value)) {
        throw new Error(
          `cloud_save_local_namespace_conflict:${entry.store}:${destinationKey}`
        );
      }
    } else {
      const destination = {
        store: entry.store,
        key: destinationKey,
        value: entry.value,
      } satisfies CloudSaveLocalNamespaceEntry;
      destinations.set(destinationId, entry.value);
      puts.set(destinationId, destination);
    }

    deletions.push({ type: "del", store: entry.store, key: entry.key });
  }

  return [
    ...[...puts.values()].map((entry) => ({ type: "put" as const, ...entry })),
    ...deletions,
  ];
};
