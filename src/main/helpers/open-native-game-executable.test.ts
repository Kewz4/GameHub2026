import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NativeGameLaunchError,
  openNativeGameExecutable,
} from "./open-native-game-executable";

describe("native Windows game launch", () => {
  it("accepts Electron's empty success result", async () => {
    await openNativeGameExecutable("game.exe", async () => "");
  });

  it("turns Electron's returned shell error into a typed launch failure", async () => {
    await assert.rejects(
      openNativeGameExecutable(
        "missing.exe",
        async () => "The system cannot find the file specified."
      ),
      (error: unknown) =>
        error instanceof NativeGameLaunchError &&
        error.code === "game_launch_failed" &&
        /cannot find the file/i.test(error.message)
    );
  });

  it("preserves a rejected openPath error as the cause", async () => {
    const cause = new Error("shell unavailable");
    await assert.rejects(
      openNativeGameExecutable("game.exe", async () => {
        throw cause;
      }),
      (error: unknown) =>
        error instanceof NativeGameLaunchError && error.cause === cause
    );
  });
});
