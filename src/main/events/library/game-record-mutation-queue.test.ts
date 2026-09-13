import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enqueueGameRecordMutation } from "./game-record-mutation-queue";

describe("game record mutation queue", () => {
  it("serializes mutations for the same game", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueGameRecordMutation("steam:1", async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = enqueueGameRecordMutation("steam:1", async () => {
      order.push("second");
    });

    await Promise.resolve();
    releaseFirst?.();
    await Promise.all([first, second]);

    assert.deepEqual(order, ["first:start", "first:end", "second"]);
  });

  it("does not block independent games", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueGameRecordMutation("steam:1", async () => {
      await gate;
      order.push("one");
    });
    const second = enqueueGameRecordMutation("steam:2", async () => {
      order.push("two");
    });

    await second;
    releaseFirst?.();
    await first;

    assert.deepEqual(order, ["two", "one"]);
  });
});
