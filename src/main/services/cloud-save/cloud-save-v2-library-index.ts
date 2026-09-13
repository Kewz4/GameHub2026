import type { CloudSaveV2LibraryEntry, GameShop } from "@types";

import {
  assertR2CloudSaveV2HeadConsistency,
  type R2CloudSaveV2Head,
} from "./r2-snapshot-contract";

const CLOUD_SAVE_V2_SHOPS = new Set<GameShop>([
  "steam",
  "epic",
  "gog",
  "battlenet",
  "xbox",
  "riot",
  "ubisoft",
  "ea",
  "launchbox",
  "custom",
]);

const MAX_LIBRARY_ENTRIES = 100_000;
const DEFAULT_LOAD_CONCURRENCY = 8;
const MAX_LOAD_CONCURRENCY = 32;

export interface CloudSaveV2LibraryIdentity {
  shop: GameShop;
  objectId: string;
  controlKey: string;
}

export interface CloudSaveV2LibraryObjectPage {
  keys: readonly (string | null | undefined)[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface ListCloudSaveV2LibraryIndexOptions {
  prefix: string;
  listPage: (
    continuationToken?: string
  ) => Promise<CloudSaveV2LibraryObjectPage>;
  loadHead: (
    identity: CloudSaveV2LibraryIdentity
  ) => Promise<R2CloudSaveV2Head | null>;
  onInvalidEntry?: (
    identity: CloudSaveV2LibraryIdentity,
    error: unknown
  ) => void;
  maxEntries?: number;
  loadConcurrency?: number;
}

export interface LocalCloudSaveV2GameMetadata {
  shop: GameShop;
  objectId: string;
  title: string;
  customIconUrl?: string | null;
  iconUrl?: string | null;
}

const identityKey = (shop: GameShop, objectId: string) =>
  JSON.stringify([shop, objectId]);

const decodeCanonicalSegment = (segment: string) => {
  if (!segment) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return encodeURIComponent(decoded) === segment ? decoded : null;
  } catch {
    return null;
  }
};

const containsControlCharacter = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

const isSafeObjectId = (value: string) =>
  value.length > 0 && value.length <= 512 && !containsControlCharacter(value);

export const isCloudSaveV2LibraryShop = (value: string): value is GameShop =>
  CLOUD_SAVE_V2_SHOPS.has(value as GameShop);

/** Parse only the one canonical key shape authored by the V2 snapshot store. */
export const parseCloudSaveV2ControlKey = (
  prefix: string,
  key: string
): CloudSaveV2LibraryIdentity | null => {
  if (!key.startsWith(prefix)) return null;
  const parts = key.slice(prefix.length).split("/");
  if (parts.length !== 3 || parts[2] !== "control.json") return null;

  const shop = decodeCanonicalSegment(parts[0]);
  const objectId = decodeCanonicalSegment(parts[1]);
  if (
    !shop ||
    !objectId ||
    !isCloudSaveV2LibraryShop(shop) ||
    !isSafeObjectId(objectId)
  ) {
    return null;
  }

  return { shop, objectId, controlKey: key };
};

const compareEntries = (
  left: CloudSaveV2LibraryEntry,
  right: CloudSaveV2LibraryEntry
) =>
  right.updatedAt.localeCompare(left.updatedAt) ||
  left.shop.localeCompare(right.shop) ||
  left.objectId.localeCompare(right.objectId);

/**
 * Discover canonical game heads, then load each complete validated R2 head.
 * Pagination is fail-closed and corrupt/dangling per-game entries are isolated.
 */
export const listCloudSaveV2LibraryIndex = async ({
  prefix,
  listPage,
  loadHead,
  onInvalidEntry,
  maxEntries = MAX_LIBRARY_ENTRIES,
  loadConcurrency = DEFAULT_LOAD_CONCURRENCY,
}: ListCloudSaveV2LibraryIndexOptions): Promise<CloudSaveV2LibraryEntry[]> => {
  const entryLimit =
    Number.isSafeInteger(maxEntries) && maxEntries > 0
      ? Math.min(maxEntries, MAX_LIBRARY_ENTRIES)
      : MAX_LIBRARY_ENTRIES;
  const concurrency =
    Number.isSafeInteger(loadConcurrency) && loadConcurrency > 0
      ? Math.min(loadConcurrency, MAX_LOAD_CONCURRENCY)
      : DEFAULT_LOAD_CONCURRENCY;
  const identities = new Map<string, CloudSaveV2LibraryIdentity>();
  const usedContinuationTokens = new Set<string>();
  let continuationToken: string | undefined;
  let controlKeyCount = 0;

  for (;;) {
    const page = await listPage(continuationToken);
    for (const key of page.keys) {
      if (typeof key !== "string" || !key.endsWith("/control.json")) {
        continue;
      }
      controlKeyCount += 1;
      if (controlKeyCount > entryLimit) {
        throw new Error("cloud_save_library_too_many_entries");
      }
      const identity = parseCloudSaveV2ControlKey(prefix, key);
      if (!identity) continue;
      identities.set(identityKey(identity.shop, identity.objectId), identity);
    }

    if (!page.isTruncated) break;
    const nextToken = page.nextContinuationToken;
    if (!nextToken || usedContinuationTokens.has(nextToken)) {
      throw new Error("cloud_save_library_invalid_page");
    }
    usedContinuationTokens.add(nextToken);
    continuationToken = nextToken;
  }

  const pending = [...identities.values()];
  const entries: CloudSaveV2LibraryEntry[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, pending.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const identity = pending[nextIndex++];
      if (!identity) return;
      try {
        const head = await loadHead(identity);
        if (!head) continue;
        assertR2CloudSaveV2HeadConsistency(head.control, head.document);
        if (head.control.status !== "active") continue;
        if (!head.control.snapshot) continue;
        if (!head.document) {
          throw new Error("cloud_save_library_dangling_head");
        }
        if (
          head.document.snapshot.shop !== identity.shop ||
          head.document.snapshot.objectId !== identity.objectId
        ) {
          throw new Error("cloud_save_library_identity_mismatch");
        }

        const snapshot = head.document.snapshot;
        entries.push({
          id: snapshot.id,
          version: snapshot.version,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          fileCount: snapshot.fileCount,
          totalSizeBytes: snapshot.totalSizeBytes,
          aggregateHash: snapshot.aggregateHash,
          shop: identity.shop,
          objectId: identity.objectId,
          gameTitle: identity.objectId,
          gameIconUrl: null,
        });
      } catch (error) {
        onInvalidEntry?.(identity, error);
      }
    }
  });
  await Promise.all(workers);
  return entries.sort(compareEntries);
};

/** Add local presentation metadata without trusting it for remote identity. */
export const mergeCloudSaveV2LibraryMetadata = (
  entries: readonly CloudSaveV2LibraryEntry[],
  games: readonly LocalCloudSaveV2GameMetadata[]
) => {
  const gameById = new Map(
    games.map((game) => [identityKey(game.shop, game.objectId), game])
  );
  return entries
    .map((entry) => {
      const game = gameById.get(identityKey(entry.shop, entry.objectId));
      return {
        ...entry,
        gameTitle: game?.title ?? entry.objectId,
        gameIconUrl: game?.customIconUrl ?? game?.iconUrl ?? null,
      };
    })
    .sort(compareEntries);
};
