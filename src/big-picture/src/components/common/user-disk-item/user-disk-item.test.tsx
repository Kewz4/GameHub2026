import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getUserDiskUsagePresentation } from "./user-disk-item-presentation";

describe("Big Picture disk usage presentation", () => {
  it("labels unresolved capacity as loading instead of reporting 0 B", () => {
    const presentation = getUserDiskUsagePresentation("loading", 0, 0);

    assert.equal(presentation.statusText, "Checking available storage…");
    assert.equal(presentation.statusRole, "status");
    assert.equal(presentation.usedRatio, 0);
  });

  it("distinguishes a failed capacity query from a real zero-capacity value", () => {
    const unavailable = getUserDiskUsagePresentation("unavailable", 0, 0);
    const ready = getUserDiskUsagePresentation("ready", 0, 0);

    assert.equal(unavailable.statusText, "Storage information unavailable");
    assert.equal(unavailable.statusRole, "alert");
    assert.equal(ready.statusText, null);
    assert.equal(ready.statusRole, null);
  });
});
