import type { ExophaseCacheEntry } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

/**
 * Shared cache of Exophase achievement *definitions* keyed by
 * `${shop}:${normalizedTitle}`. Definitions are not user-specific, so this
 * store is mirrored to R2 (`shared/exophase-cache.json`) and merged across
 * every friend's launcher — once anyone has fetched a game's awards page, the
 * rest get its achievement list instantly with no network.
 */
export const exophaseCacheSublevel = db.sublevel<string, ExophaseCacheEntry>(
  levelKeys.exophaseCache,
  {
    valueEncoding: "json",
  }
);
