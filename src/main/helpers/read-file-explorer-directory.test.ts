import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileExplorerDirectory } from "./read-file-explorer-directory";

test("file picker returns directories first and file metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gamehub-picker-"));
  try {
    await fs.mkdir(path.join(root, "z-directory"));
    await fs.writeFile(path.join(root, "a-file.AppImage"), "data");
    const result = await readFileExplorerDirectory(root);
    assert.equal(result[0].name, "z-directory");
    assert.equal(result[1].extension, "appimage");
    assert.equal(result[1].size, 4);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(
  "file picker follows one symlink for metadata without traversing loops",
  { skip: process.platform === "win32" },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "gamehub-picker-link-")
    );
    try {
      await fs.mkdir(path.join(root, "Steam"));
      await fs.writeFile(path.join(root, "emulator"), "binary");
      await fs.symlink(path.join(root, "Steam"), path.join(root, "steam-root"));
      await fs.symlink(
        path.join(root, "emulator"),
        path.join(root, "emulator-link")
      );
      await fs.symlink(path.join(root, "missing"), path.join(root, "broken"));
      await fs.symlink(root, path.join(root, "self"));
      const result = await readFileExplorerDirectory(root);
      assert.equal(
        result.find((entry) => entry.name === "steam-root")?.isDirectory,
        true
      );
      assert.equal(
        result.find((entry) => entry.name === "emulator-link")?.isFile,
        true
      );
      assert.equal(
        result.find((entry) => entry.name === "self")?.isDirectory,
        true
      );
      assert.equal(
        result.some((entry) => entry.name === "broken"),
        false
      );
      assert.equal(result.length, 5);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
);
