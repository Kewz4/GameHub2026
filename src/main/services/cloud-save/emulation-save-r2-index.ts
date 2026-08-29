import { mapWithConcurrency } from "./map-with-concurrency";

const MAX_EMULATION_SAVE_OBJECTS = 100_000;
const DEFAULT_HEAD_CONCURRENCY = 8;
const MAX_HEAD_CONCURRENCY = 32;

export interface EmulationSaveObjectPage {
  objects: readonly {
    key: string | null | undefined;
    size?: number;
    lastModified?: Date;
  }[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface IndexedEmulationSaveObject {
  key: string;
  size: number;
  lastModified: Date;
  metadata: Record<string, string>;
}

interface ListEmulationSaveR2IndexOptions {
  prefix: string;
  relativeSegmentCount: number;
  listPage: (continuationToken?: string) => Promise<EmulationSaveObjectPage>;
  loadMetadata: (key: string) => Promise<Record<string, string> | null>;
  maxObjects?: number;
  headConcurrency?: number;
}

const hasCanonicalRelativeKey = (
  prefix: string,
  relativeSegmentCount: number,
  key: string
) => {
  if (!key.startsWith(prefix)) return false;
  const segments = key.slice(prefix.length).split("/");
  return (
    segments.length === relativeSegmentCount &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("\\")
    )
  );
};

/** Paginated, bounded discovery for the legacy PS1/PS2 memory-card exports. */
export const listEmulationSaveR2Index = async ({
  prefix,
  relativeSegmentCount,
  listPage,
  loadMetadata,
  maxObjects = MAX_EMULATION_SAVE_OBJECTS,
  headConcurrency = DEFAULT_HEAD_CONCURRENCY,
}: ListEmulationSaveR2IndexOptions): Promise<IndexedEmulationSaveObject[]> => {
  const objectLimit =
    Number.isSafeInteger(maxObjects) && maxObjects > 0
      ? Math.min(maxObjects, MAX_EMULATION_SAVE_OBJECTS)
      : MAX_EMULATION_SAVE_OBJECTS;
  const concurrency =
    Number.isSafeInteger(headConcurrency) && headConcurrency > 0
      ? Math.min(headConcurrency, MAX_HEAD_CONCURRENCY)
      : DEFAULT_HEAD_CONCURRENCY;
  if (!Number.isSafeInteger(relativeSegmentCount) || relativeSegmentCount < 1) {
    throw new Error("emulation_save_index_invalid_segment_count");
  }

  const objects = new Map<
    string,
    { key: string; size: number; lastModified: Date }
  >();
  const usedContinuationTokens = new Set<string>();
  let continuationToken: string | undefined;
  let discoveredObjectCount = 0;

  for (;;) {
    const page = await listPage(continuationToken);
    for (const object of page.objects) {
      if (typeof object.key !== "string") continue;
      discoveredObjectCount += 1;
      if (discoveredObjectCount > objectLimit) {
        throw new Error("emulation_save_index_too_many_objects");
      }
      if (!hasCanonicalRelativeKey(prefix, relativeSegmentCount, object.key)) {
        continue;
      }
      objects.set(object.key, {
        key: object.key,
        size: object.size ?? 0,
        lastModified: object.lastModified ?? new Date(0),
      });
    }

    if (!page.isTruncated) break;
    const nextToken = page.nextContinuationToken;
    if (!nextToken || usedContinuationTokens.has(nextToken)) {
      throw new Error("emulation_save_index_invalid_page");
    }
    usedContinuationTokens.add(nextToken);
    continuationToken = nextToken;
  }

  const indexed = await mapWithConcurrency(
    [...objects.values()],
    concurrency,
    async (object): Promise<IndexedEmulationSaveObject | null> => {
      const metadata = await loadMetadata(object.key);
      return metadata ? { ...object, metadata } : null;
    }
  );
  return indexed.filter(
    (object): object is IndexedEmulationSaveObject => object !== null
  );
};
