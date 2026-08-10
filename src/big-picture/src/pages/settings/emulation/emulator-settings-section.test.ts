import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getBigPictureToggleValues } from "./emulator-setting-presentation";

describe("Big Picture emulator setting presentation", () => {
  it("uses a controller toggle only for canonical On and Off options", () => {
    assert.deepEqual(
      getBigPictureToggleValues({
        options: [
          { value: "enabled", label: "On" },
          { value: "disabled", label: "Off" },
        ],
      }),
      { on: "enabled", off: "disabled" }
    );
  });

  it("keeps arbitrary two-choice settings as dropdowns", () => {
    assert.equal(
      getBigPictureToggleValues({
        options: [
          { value: "ntsc", label: "NTSC" },
          { value: "pal", label: "PAL" },
        ],
      }),
      null
    );
  });
});
