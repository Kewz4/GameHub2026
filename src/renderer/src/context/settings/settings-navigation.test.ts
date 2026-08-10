import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSettingsCategoryNavigationTarget,
  isSettingsCategoryId,
  resolveSettingsCategoryId,
  type SettingsCategoryId,
} from "./settings-navigation";

describe("settings navigation", () => {
  it("accepts every desktop category, including Big Picture", () => {
    assert.equal(isSettingsCategoryId("big_picture"), true);
    assert.equal(resolveSettingsCategoryId("big_picture"), "big_picture");
    assert.equal(resolveSettingsCategoryId("not-a-category"), null);
  });

  it("keeps legacy numeric deep links working", () => {
    assert.equal(resolveSettingsCategoryId("0"), "general");
    assert.equal(resolveSettingsCategoryId("2"), "downloads");
    assert.equal(resolveSettingsCategoryId("5"), "account_privacy");
    assert.equal(resolveSettingsCategoryId("99"), null);
  });

  it("supports wrapped arrow navigation plus Home and End", () => {
    const ids: SettingsCategoryId[] = ["general", "downloads", "notifications"];

    assert.equal(
      getSettingsCategoryNavigationTarget(ids, "general", "ArrowUp"),
      "notifications"
    );
    assert.equal(
      getSettingsCategoryNavigationTarget(ids, "notifications", "ArrowRight"),
      "general"
    );
    assert.equal(
      getSettingsCategoryNavigationTarget(ids, "downloads", "Home"),
      "general"
    );
    assert.equal(
      getSettingsCategoryNavigationTarget(ids, "general", "End"),
      "notifications"
    );
    assert.equal(
      getSettingsCategoryNavigationTarget(ids, "general", "Enter"),
      null
    );
  });
});
