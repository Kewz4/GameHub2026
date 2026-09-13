import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BoundedAsyncCache } from "./cloud-save-overview-cache.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe("cloud save overview cache", () => {
  it("coalesces concurrent detection into one scan", async () => {
    let scans = 0;
    const pending = deferred<number>();
    const cache = new BoundedAsyncCache<number>(2_000, 8);
    const load = () => {
      scans += 1;
      return pending.promise;
    };

    const first = cache.getOrLoad("game", load);
    const second = cache.getOrLoad("game", load);
    assert.equal(scans, 1);
    pending.resolve(7);
    assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  });

  it("serves a bounded TTL hit without scanning again", async () => {
    let now = 10;
    let scans = 0;
    const cache = new BoundedAsyncCache<number>(2_000, 8, () => now);
    const load = async () => ++scans;

    assert.equal(await cache.getOrLoad("game", load), 1);
    now += 1_999;
    assert.equal(await cache.getOrLoad("game", load), 1);
    assert.equal(scans, 1);
  });

  it("rescans exactly once after invalidation or expiry", async () => {
    let now = 0;
    let scans = 0;
    const cache = new BoundedAsyncCache<number>(2_000, 8, () => now);
    const load = async () => ++scans;

    await cache.getOrLoad("game", load);
    cache.invalidate("game");
    assert.equal(await cache.getOrLoad("game", load), 2);
    now = 2_001;
    assert.equal(await cache.getOrLoad("game", load), 3);
    assert.equal(scans, 3);
  });

  it("does not publish or coalesce a scan invalidated while in flight", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    let scans = 0;
    const cache = new BoundedAsyncCache<number>(2_000, 8);
    const load = () => {
      scans += 1;
      return scans === 1 ? first.promise : second.promise;
    };

    const staleRequest = cache.getOrLoad("game", load);
    cache.invalidate("game");
    const freshRequest = cache.getOrLoad("game", load);
    assert.equal(scans, 2);
    first.resolve(1);
    second.resolve(2);
    assert.equal(await staleRequest, 1);
    assert.equal(await freshRequest, 2);
    assert.equal(await cache.getOrLoad("game", load), 2);
    assert.equal(scans, 2);
  });
});
