import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getNextDesktopSidebarHidden,
  isDesktopSidebarVisible,
} from "./sidebar-visibility";

describe("desktop sidebar visibility", () => {
  it("waits for preferences before mounting the sidebar", () => {
    assert.equal(isDesktopSidebarVisible(null), false);
    assert.equal(isDesktopSidebarVisible({}), true);
    assert.equal(isDesktopSidebarVisible({ hideSidebar: false }), true);
    assert.equal(isDesktopSidebarVisible({ hideSidebar: true }), false);
  });

  it("derives the persisted hidden state used by the header action", () => {
    assert.equal(getNextDesktopSidebarHidden({ hideSidebar: true }), false);
    assert.equal(getNextDesktopSidebarHidden({ hideSidebar: false }), true);
    assert.equal(getNextDesktopSidebarHidden({}), true);
  });
});
