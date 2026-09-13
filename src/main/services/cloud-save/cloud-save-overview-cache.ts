import type { CloudSaveOverview, GameShop } from "@types";
import { registerR2CredentialSessionInvalidator } from "../r2-credential-session";

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

export class BoundedAsyncCache<T> {
  private readonly values = new Map<string, CachedValue<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly generations = new Map<string, number>();
  private globalGeneration = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {}

  getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > this.now()) {
      // Refresh insertion order so eviction approximates LRU.
      this.values.delete(key);
      this.values.set(key, cached);
      return Promise.resolve(cached.value);
    }
    if (cached) this.values.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const generation = this.generations.get(key) ?? 0;
    const globalGeneration = this.globalGeneration;
    const request = load()
      .then((value) => {
        if (
          this.globalGeneration === globalGeneration &&
          (this.generations.get(key) ?? 0) === generation &&
          this.inFlight.get(key) === request
        ) {
          this.values.set(key, {
            value,
            expiresAt: this.now() + this.ttlMs,
          });
          while (this.values.size > this.maxEntries) {
            const oldest = this.values.keys().next().value as
              | string
              | undefined;
            if (oldest === undefined) break;
            this.values.delete(oldest);
          }
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  invalidate(key: string) {
    this.values.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.inFlight.delete(key);
  }

  clear() {
    this.globalGeneration += 1;
    this.values.clear();
    this.inFlight.clear();
    this.generations.clear();
  }
}

const overviewCache = new BoundedAsyncCache<CloudSaveOverview>(2_000, 64);
const overviewKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

export const getCachedCloudSaveOverview = (
  objectId: string,
  shop: GameShop,
  load: () => Promise<CloudSaveOverview>
) => overviewCache.getOrLoad(overviewKey(objectId, shop), load);

export const invalidateCloudSaveOverview = (objectId: string, shop: GameShop) =>
  overviewCache.invalidate(overviewKey(objectId, shop));

export const clearCloudSaveOverviewCache = () => overviewCache.clear();

registerR2CredentialSessionInvalidator(clearCloudSaveOverviewCache);
