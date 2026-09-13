import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GAMEHUB_CLOUD_SAVES_COPY } from "./account-privacy-cloud";

describe("Big Picture GameHub Cloud copy", () => {
  it("describes the R2-backed V2 service without a paywall", () => {
    const copy = Object.values(GAMEHUB_CLOUD_SAVES_COPY).join(" ");

    assert.match(copy, /R2/);
    assert.match(copy, /Cloud Saves V2/);
    assert.match(copy, /No subscription/);
    assert.doesNotMatch(copy, /Hydra Cloud|checkout|renew|plan/i);
  });
});
