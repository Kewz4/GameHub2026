import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { destroyOverlayWindow } from "./overlay-window-lifecycle";

describe("overlay window lifecycle", () => {
  it("clears the stale reference before destroying the resident renderer", () => {
    const events: string[] = [];
    const window = {
      isDestroyed: () => false,
      destroy: () => events.push("destroy"),
    };

    destroyOverlayWindow(window, () => events.push("clear"));
    assert.deepEqual(events, ["clear", "destroy"]);
  });

  it("allows a clean renderer to be created after every re-arm", () => {
    let current: { generation: number; destroyed: boolean } | null = null;
    let generation = 0;
    const ensureWindow = () => {
      if (current && !current.destroyed) return current;
      current = { generation: ++generation, destroyed: false };
      return current;
    };

    const first = ensureWindow();
    destroyOverlayWindow(
      {
        isDestroyed: () => first.destroyed,
        destroy: () => {
          first.destroyed = true;
        },
      },
      () => {
        if (current === first) current = null;
      }
    );
    const second = ensureWindow();

    assert.notStrictEqual(second, first);
    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, false);
    assert.equal(second.generation, 2);
  });

  it("does not destroy an already-closed window twice", () => {
    let destroys = 0;
    destroyOverlayWindow(
      { isDestroyed: () => true, destroy: () => (destroys += 1) },
      () => undefined
    );
    assert.equal(destroys, 0);
  });
});
