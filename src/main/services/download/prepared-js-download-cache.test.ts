import assert from "node:assert/strict";
import test from "node:test";
import {
  PREPARED_JS_DOWNLOAD_TTL_MS,
  PreparedJsDownloadCache,
} from "./prepared-js-download-cache";

test("consumes a validated download exactly once", () => {
  const cache = new PreparedJsDownloadCache<{ url: string }>();
  const options = { url: "https://cdn.example/game.zip?token=one-time" };

  cache.set("steam:123", "https://provider.example/file/123", options);

  assert.equal(
    cache.take("steam:123", "https://provider.example/file/123"),
    options
  );
  assert.equal(
    cache.take("steam:123", "https://provider.example/file/123"),
    null
  );
});

test("isolates overlapping validations by download id and source URI", () => {
  const cache = new PreparedJsDownloadCache<{ url: string }>();
  const first = { url: "https://cdn.example/first" };
  const second = { url: "https://cdn.example/second" };
  const otherGame = { url: "https://cdn.example/other-game" };

  cache.set("steam:123", "https://provider.example/first", first);
  cache.set("steam:123", "https://provider.example/second", second);
  cache.set("steam:456", "https://provider.example/first", otherGame);

  assert.equal(
    cache.take("steam:123", "https://provider.example/second"),
    second
  );
  assert.equal(
    cache.take("steam:456", "https://provider.example/first"),
    otherGame
  );
  assert.equal(
    cache.take("steam:123", "https://provider.example/first"),
    first
  );
});

test("rejects expired, mismatched, and future-dated prepared downloads", () => {
  let now = 10_000;
  const cache = new PreparedJsDownloadCache<{ url: string }>(
    PREPARED_JS_DOWNLOAD_TTL_MS,
    () => now
  );

  cache.set("steam:123", "https://provider.example/right", {
    url: "https://cdn.example/right",
  });

  assert.equal(cache.take("steam:123", "https://provider.example/wrong"), null);

  now += PREPARED_JS_DOWNLOAD_TTL_MS + 1;
  assert.equal(cache.take("steam:123", "https://provider.example/right"), null);

  cache.set("steam:123", "https://provider.example/future", {
    url: "https://cdn.example/future",
  });
  now -= 1;
  assert.equal(
    cache.take("steam:123", "https://provider.example/future"),
    null
  );
});
