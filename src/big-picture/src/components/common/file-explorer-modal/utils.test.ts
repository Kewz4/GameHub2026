import assert from "node:assert/strict";
import { test } from "node:test";
import { getGameExecutableFilters } from "@shared";
import {
  getParentPath,
  matchesFilters,
  normalizeFilters,
  type DirectoryEntry,
} from "./utils";

const entry = (
  name: string,
  extension = "",
  isDirectory = false
): DirectoryEntry => ({
  name,
  path: `/home/player/Games/${name}`,
  extension,
  isDirectory,
  isFile: !isDirectory,
  size: 4096,
});

test("Linux executable filters retain extensionless binaries and AppImages", () => {
  const filters = normalizeFilters(
    getGameExecutableFilters("linux", {
      executable: "Executable",
      allFiles: "All files",
    })
  );
  assert.equal(matchesFilters(entry("hades"), filters, false), true);
  assert.equal(
    matchesFilters(entry("PCSX2.AppImage", "AppImage"), filters, false),
    true
  );
  assert.equal(matchesFilters(entry("game.exe", "exe"), filters, false), true);
});

test("specific ROM filters remain specific; directory selection never accepts files", () => {
  const filters = normalizeFilters([
    { name: "ROM", extensions: ["iso", "chd"] },
  ]);
  assert.equal(matchesFilters(entry("game.chd", "CHD"), filters, false), true);
  assert.equal(
    matchesFilters(entry("readme.txt", "txt"), filters, false),
    false
  );
  assert.equal(matchesFilters(entry(".local", "", true), filters, true), true);
  assert.equal(matchesFilters(entry("game.chd", "chd"), filters, true), false);
});

test("parent navigation handles Linux roots, trailing slashes, spaces and hidden paths", () => {
  assert.equal(getParentPath("/"), null);
  assert.equal(getParentPath("///"), null);
  assert.equal(getParentPath("/home///"), "/");
  assert.equal(
    getParentPath("/home/player/.local/share"),
    "/home/player/.local"
  );
  assert.equal(
    getParentPath("/run/media/player/Game Drive"),
    "/run/media/player"
  );
  assert.equal(getParentPath("C:\\Games\\"), "C:\\");
  assert.equal(getParentPath("C:\\"), null);
});
