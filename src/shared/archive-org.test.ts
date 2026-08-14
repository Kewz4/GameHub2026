import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isArchiveOrgFileUri,
  parseArchiveOrgFileUri,
  resolveArchiveOrgFile,
} from "./archive-org";

describe("Archive.org file URLs", () => {
  it("accepts canonical and node file links", () => {
    assert.deepEqual(
      parseArchiveOrgFileUri(
        "https://archive.org/download/game-item/Game%20Files/setup.zip"
      ),
      { identifier: "game-item", path: "Game Files/setup.zip" }
    );
    assert.deepEqual(
      resolveArchiveOrgFile(
        "https://ia801234.us.archive.org/12/items/game-item/Game%20Files/setup.zip?download=1"
      ),
      {
        url: "https://archive.org/download/game-item/Game%20Files/setup.zip",
        filename: "setup.zip",
      }
    );
  });

  it("rejects item pages, directories, lookalike hosts, and non-web schemes", () => {
    for (const uri of [
      "https://archive.org/details/game-item",
      "https://archive.org/download/game-item/",
      "https://archive.org.evil.test/download/game-item/setup.zip",
      "file:///download/game-item/setup.zip",
      "not a URL",
    ]) {
      assert.equal(isArchiveOrgFileUri(uri), false, uri);
    }
  });

  it("rejects raw and encoded path traversal before URL normalization", () => {
    for (const uri of [
      "https://archive.org/download/game-item/../Folder/My%20Game.7z",
      "https://archive.org/download/game-item/%2e%2e/Folder/My%20Game.7z",
      "https://archive.org/download/game-item/%2e%2e%2fFolder/My%20Game.7z",
    ]) {
      assert.equal(resolveArchiveOrgFile(uri), null, uri);
    }
  });
});
