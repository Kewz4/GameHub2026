import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CoalescedWindowCreation } from "./coalesced-window-creation";

describe("coalesced window creation", () => {
  it("returns one pending window to concurrent callers", async () => {
    const coordinator = new CoalescedWindowCreation<{ ready: boolean }>();
    const state: {
      published: { ready: boolean } | null;
      finishCreation?: () => void;
    } = { published: null };
    let createCount = 0;

    const create = async () => {
      createCount += 1;
      state.published = { ready: false };
      await new Promise<void>((resolve) => {
        state.finishCreation = resolve;
      });
      state.published.ready = true;
      return state.published;
    };

    const first = coordinator.getOrCreate(() => state.published, create);
    const second = coordinator.getOrCreate(() => state.published, create);

    assert.equal(createCount, 1);
    assert.equal(state.published?.ready, false);
    assert.equal(
      await Promise.race([
        second.then(() => "resolved"),
        Promise.resolve("pending"),
      ]),
      "pending",
      "a published but unready window must not escape the shared promise"
    );

    state.finishCreation?.();
    assert.equal((await first)?.ready, true);
    assert.strictEqual(await second, state.published);
  });

  it("clears a rejected creation so a later call can retry", async () => {
    const coordinator = new CoalescedWindowCreation<object>();
    let attempts = 0;
    const create = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("renderer did not become ready");
      return {};
    };

    await assert.rejects(
      coordinator.getOrCreate(() => null, create),
      /renderer did not become ready/
    );
    assert.ok(await coordinator.getOrCreate(() => null, create));
    assert.equal(attempts, 2);
  });
});
