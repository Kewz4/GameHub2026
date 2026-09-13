import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getBigPictureRoutePath } from "./navigation";

describe("Big Picture route paths", () => {
  it("keeps standalone routes rooted at the application shell", () => {
    assert.equal(
      getBigPictureRoutePath("/settings?tab=integrations", false),
      "/settings?tab=integrations"
    );
  });

  it("keeps embedded navigation inside the desktop Big Picture shell", () => {
    assert.equal(
      getBigPictureRoutePath("/settings?tab=integrations", true),
      "/big-picture/settings?tab=integrations"
    );
  });
});
