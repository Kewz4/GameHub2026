import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMediaToolPath } from "./media-tool-path";

test("Linux recorder resolves executable system ffmpeg, never a Windows filename", () => {
  assert.equal(
    resolveMediaToolPath({
      platform: "linux",
      resourcesPath: "/opt/GameHub/resources",
      appPath: "/app",
      isPackaged: true,
      searchPath: ".::/usr/local/bin:/usr/bin",
      executable: (candidate) => candidate === "/usr/bin/ffmpeg",
    }),
    "/usr/bin/ffmpeg"
  );
});
test("bundled executable takes precedence and Windows lookup is unchanged", () => {
  const options = {
    platform: "linux" as const,
    resourcesPath: "/resources",
    appPath: "/app",
    isPackaged: true,
    searchPath: "/usr/bin",
    executable: () => true,
  };
  assert.match(resolveMediaToolPath(options), /ffmpeg[\\/]ffmpeg$/);
  assert.match(
    resolveMediaToolPath({
      ...options,
      platform: "win32",
      executable: () => false,
    }),
    /ffmpeg[\\/]ffmpeg\.exe$/
  );
});
