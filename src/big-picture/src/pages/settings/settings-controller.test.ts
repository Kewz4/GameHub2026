import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BIG_PICTURE_APP_LAYER_ID } from "../../layout/navigation";
import {
  canHandleSettingsBumperInput,
  getIntegrationsInitialFocusId,
  getSettingsSearchForTab,
  resolveSettingsContentTopClearance,
} from "./settings-controller";
import {
  INTEGRATIONS_STEAM_PRIMARY_BTN_ID,
  INTEGRATIONS_STEAM_SYNC_BTN_ID,
} from "./settings-navigation";

describe("Big Picture settings controller isolation", () => {
  it("allows bumpers while the settings page owns the active layer", () => {
    assert.equal(
      canHandleSettingsBumperInput(BIG_PICTURE_APP_LAYER_ID, false),
      true
    );
  });

  it("blocks background tab changes while an overlay layer is active", () => {
    assert.equal(canHandleSettingsBumperInput("modal-layer", false), false);
    assert.equal(
      canHandleSettingsBumperInput(BIG_PICTURE_APP_LAYER_ID, true),
      false
    );
  });

  it("moves the deep link with bumper and pointer tab selection", () => {
    assert.equal(
      getSettingsSearchForTab("?tab=content&section=sources", "big-picture"),
      "?tab=big-picture"
    );
  });

  it("enters Integrations at the first visible platform action", () => {
    assert.equal(
      getIntegrationsInitialFocusId(null),
      INTEGRATIONS_STEAM_PRIMARY_BTN_ID
    );
    assert.equal(
      getIntegrationsInitialFocusId("linked-steam-account"),
      INTEGRATIONS_STEAM_SYNC_BTN_ID
    );
  });

  it("reserves the sticky rail plus a safety gap above content", () => {
    const measuredRailHeight = 55.1;
    const clearance = resolveSettingsContentTopClearance(measuredRailHeight);

    // The sticky rail is already in normal flow; never reserve its height twice.
    assert.equal(clearance, 12);
    assert.ok(clearance < Math.ceil(measuredRailHeight));
    assert.equal(resolveSettingsContentTopClearance(0), 12);
    assert.equal(resolveSettingsContentTopClearance(Number.NaN), 0);
    assert.equal(resolveSettingsContentTopClearance(56, 44.2), 57);
    assert.equal(resolveSettingsContentTopClearance(56, -12), 12);
  });
});
