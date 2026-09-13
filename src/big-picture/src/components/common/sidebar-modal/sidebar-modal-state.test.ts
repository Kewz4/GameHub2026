import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSidebarModalIdSegment,
  resolveSidebarModalActiveTab,
} from "./sidebar-modal-state";

describe("SidebarModal state", () => {
  const tabs = [
    { id: "launch", disabled: true },
    { id: "cloud_saves" },
    { id: "downloads" },
  ] as const;

  it("keeps an enabled requested tab active", () => {
    assert.equal(
      resolveSidebarModalActiveTab(tabs, "downloads")?.id,
      "downloads"
    );
  });

  it("falls back to the first enabled tab for missing or disabled ids", () => {
    assert.equal(
      resolveSidebarModalActiveTab(tabs, "launch")?.id,
      "cloud_saves"
    );
    assert.equal(
      resolveSidebarModalActiveTab(tabs, "missing")?.id,
      "cloud_saves"
    );
  });

  it("returns no active tab when every tab is disabled", () => {
    assert.equal(
      resolveSidebarModalActiveTab([{ id: "only", disabled: true }]),
      null
    );
  });

  it("normalizes tab ids before using them as DOM focus ids", () => {
    assert.equal(
      normalizeSidebarModalIdSegment("cloud saves/<custom>"),
      "cloud-saves--custom-"
    );
  });
});
