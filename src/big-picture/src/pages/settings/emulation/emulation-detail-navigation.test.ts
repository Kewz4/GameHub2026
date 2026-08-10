import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID,
  EMULATION_DETAIL_CLOUD_SAVES_REGION_ID,
  EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_REGION_ID,
} from "../settings-navigation";
import { EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS } from "./emulation-detail-navigation";

describe("Big Picture emulator-save focus boundaries", () => {
  it("targets real buttons between memory cards and cloud saves", () => {
    assert.equal(
      EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS.memoryCardsDown,
      EMULATION_DETAIL_CLOUD_REFRESH_BUTTON_ID
    );
    assert.equal(
      EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS.cloudSavesUp,
      EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID
    );
    assert.notEqual(
      EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS.memoryCardsDown,
      EMULATION_DETAIL_CLOUD_SAVES_REGION_ID
    );
    assert.notEqual(
      EMULATION_DETAIL_SAVE_BOUNDARY_TARGETS.cloudSavesUp,
      EMULATION_DETAIL_MEMORY_CARDS_REGION_ID
    );
  });
});
