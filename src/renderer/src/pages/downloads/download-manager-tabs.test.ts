import assert from "node:assert/strict";
import test from "node:test";
import { getAdjacentDownloadManagerTab } from "./download-manager-tabs";

test("download manager tabs wrap with horizontal arrow navigation", () => {
  assert.equal(
    getAdjacentDownloadManagerTab("downloads", "ArrowRight"),
    "custom"
  );
  assert.equal(
    getAdjacentDownloadManagerTab("custom", "ArrowRight"),
    "downloads"
  );
  assert.equal(
    getAdjacentDownloadManagerTab("downloads", "ArrowLeft"),
    "custom"
  );
  assert.equal(
    getAdjacentDownloadManagerTab("custom", "ArrowLeft"),
    "downloads"
  );
});
