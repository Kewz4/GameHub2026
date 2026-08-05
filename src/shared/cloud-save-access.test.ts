import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveAccessAction } from "./cloud-save-access.js";

describe("cloud save access", () => {
  it("asks signed-out users to authenticate with the R2 broker", () => {
    assert.equal(getCloudSaveAccessAction(false, false), "sign-in");
  });

  it("does not require a Hydra subscription", () => {
    assert.equal(getCloudSaveAccessAction(true, false), "open");
  });

  it("opens cloud saves for active subscribers too", () => {
    assert.equal(getCloudSaveAccessAction(true, true), "open");
  });
});
