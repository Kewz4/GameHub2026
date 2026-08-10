import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EXTERNAL_RESOURCES_URL,
  buildExternalResourceUrl,
  resolveExternalResourcesUrl,
} from "./external-resources";

test("uses the production asset origin when the Vite value is missing", () => {
  assert.equal(
    resolveExternalResourcesUrl(undefined),
    DEFAULT_EXTERNAL_RESOURCES_URL
  );
  assert.equal(
    resolveExternalResourcesUrl("  "),
    DEFAULT_EXTERNAL_RESOURCES_URL
  );
  assert.equal(
    buildExternalResourceUrl("steam-genres.json", undefined),
    `${DEFAULT_EXTERNAL_RESOURCES_URL}/steam-genres.json`
  );
});

test("normalizes an explicitly configured asset origin", () => {
  assert.equal(
    resolveExternalResourcesUrl(" https://cdn.example.test/// "),
    "https://cdn.example.test"
  );
  assert.equal(
    buildExternalResourceUrl(
      "/steam-user-tags.json",
      "https://cdn.example.test/"
    ),
    "https://cdn.example.test/steam-user-tags.json"
  );
});
