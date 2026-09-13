import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCurrentGameDetailsRequest } from "./game-details-request";

describe("Big Picture game-details request isolation", () => {
  it("accepts only the newest request for the current route", () => {
    assert.equal(
      isCurrentGameDetailsRequest(4, "steam:20", {
        id: 4,
        identity: "steam:20",
      }),
      true
    );
  });

  it("rejects a slow request after a retry starts", () => {
    assert.equal(
      isCurrentGameDetailsRequest(5, "steam:20", {
        id: 4,
        identity: "steam:20",
      }),
      false
    );
  });

  it("rejects a request after navigation even before its replacement settles", () => {
    assert.equal(
      isCurrentGameDetailsRequest(4, "gog:30", {
        id: 4,
        identity: "steam:20",
      }),
      false
    );
  });
});
