import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enqueueUserPreferencesMutation } from "./user-preferences-mutation-queue";

describe("user preferences mutation queue", () => {
  it("serializes rapid read/merge/write mutations", async () => {
    const stored: Record<string, boolean> = {};
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueUserPreferencesMutation(async () => {
      const snapshot = { ...stored };
      await firstGate;
      Object.assign(stored, snapshot, { overlayEnabled: false });
    });
    const second = enqueueUserPreferencesMutation(async () => {
      const snapshot = { ...stored };
      Object.assign(stored, snapshot, { gameRecorderEnabled: true });
    });

    await Promise.resolve();
    releaseFirst?.();
    await Promise.all([first, second]);

    assert.deepEqual(stored, {
      overlayEnabled: false,
      gameRecorderEnabled: true,
    });
  });

  it("continues after a rejected mutation", async () => {
    await assert.rejects(
      enqueueUserPreferencesMutation(async () => {
        throw new Error("expected");
      }),
      /expected/
    );

    const value = await enqueueUserPreferencesMutation(async () => 42);
    assert.equal(value, 42);
  });
});
