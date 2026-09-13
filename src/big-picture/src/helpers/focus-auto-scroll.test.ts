import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveNavigationScrollAxisTarget,
  resolveNavigationScrollInsets,
} from "./focus-auto-scroll";

describe("Big Picture focus auto-scroll geometry", () => {
  it("keeps focused Settings content below a declared sticky rail", () => {
    const insets = resolveNavigationScrollInsets(
      { width: 896, height: 720 },
      { top: 184 }
    );

    assert.equal(insets.top, 184);
    assert.equal(insets.bottom, 96);
  });

  it("never horizontally displaces an overflow-hidden Settings page", () => {
    assert.equal(
      resolveNavigationScrollAxisTarget({
        current: 320,
        delta: 140,
        maximum: 600,
        enabled: false,
      }),
      0
    );
  });
});
