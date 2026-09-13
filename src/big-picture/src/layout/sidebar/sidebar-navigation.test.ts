import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSidebarNavigationOverrides } from "./sidebar-navigation";

const contentTarget = {
  type: "region" as const,
  regionId: "content",
};

describe("Big Picture sidebar controller navigation", () => {
  it("creates a deterministic circular route, exit, and library chain", () => {
    const overrides = buildSidebarNavigationOverrides(
      ["home", "library", "exit", "game-1", "game-2"],
      contentTarget
    );

    assert.deepEqual(overrides.get("home"), {
      left: { type: "block" },
      right: contentTarget,
      up: { type: "item", itemId: "game-2" },
      down: { type: "item", itemId: "library" },
    });
    assert.deepEqual(overrides.get("exit")?.up, {
      type: "item",
      itemId: "library",
    });
    assert.deepEqual(overrides.get("exit")?.down, {
      type: "item",
      itemId: "game-1",
    });
    assert.deepEqual(overrides.get("game-2")?.down, {
      type: "item",
      itemId: "home",
    });
  });

  it("keeps a one-item sidebar stable in both directions", () => {
    const overrides = buildSidebarNavigationOverrides(["only"], contentTarget);

    assert.deepEqual(overrides.get("only")?.up, {
      type: "item",
      itemId: "only",
    });
    assert.deepEqual(overrides.get("only")?.down, {
      type: "item",
      itemId: "only",
    });
  });

  it("returns no overrides for an empty sidebar", () => {
    assert.equal(buildSidebarNavigationOverrides([], contentTarget).size, 0);
  });
});
