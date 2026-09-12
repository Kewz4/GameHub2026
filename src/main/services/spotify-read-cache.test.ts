import { test } from "node:test";
import assert from "node:assert/strict";
import { SpotifyReadCache } from "./spotify-read-cache";

test("sidebar and overlay share a Connect read and refresh after expiry", async () => {
  let now = 0;
  let calls = 0;
  const cache = new SpotifyReadCache(1000, () => now);
  const read = () => cache.read("playback", async () => ++calls);
  assert.deepEqual(await Promise.all([read(), read()]), [1, 1]);
  now = 1001;
  assert.equal(await read(), 2);
});

test("commands invalidate cached playback and failed reads are retryable", async () => {
  const cache = new SpotifyReadCache();
  await cache.read("playback", async () => "playing");
  cache.clear();
  assert.equal(await cache.read("playback", async () => "paused"), "paused");
  await assert.rejects(
    cache.read("devices", async () => {
      throw new Error("offline");
    })
  );
  assert.equal(await cache.read("devices", async () => "desktop"), "desktop");
});

test("an old rejected read cannot discard a fresh read after a command", async () => {
  const cache = new SpotifyReadCache();
  let rejectOld!: (error: Error) => void;
  const stale = cache.read(
    "playback",
    () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      })
  );
  const rejection = assert.rejects(stale);
  cache.clear();
  await cache.read("playback", async () => "fresh");
  rejectOld(new Error("stale"));
  await rejection;
  assert.equal(await cache.read("playback", async () => "unexpected"), "fresh");
});
