import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BIG_PICTURE_APP_LAYER_ID } from "../../layout/navigation";
import {
  getLibraryConsoleDirectionalTargets,
  getLibraryConsoleFocusOrder,
  getSelectedLibraryConsoleFocusId,
} from "../../components/pages/library/filter-controller";
import {
  getLibraryFiltersConsolePillId,
  LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID,
} from "../../components/pages/library/navigation";
import {
  canHandleLibraryBumperInput,
  getAdjacentLibraryTab,
  getLibraryTabOrder,
} from "./library-controller";

describe("Big Picture library controller navigation", () => {
  it("accepts bumpers only on the app layer with the keyboard closed", () => {
    assert.equal(
      canHandleLibraryBumperInput(BIG_PICTURE_APP_LAYER_ID, false),
      true
    );
    assert.equal(canHandleLibraryBumperInput("context-menu", false), false);
    assert.equal(
      canHandleLibraryBumperInput(BIG_PICTURE_APP_LAYER_ID, true),
      false
    );
  });

  it("uses the visible built-in and alphabetical collection order", () => {
    assert.deepEqual(
      getLibraryTabOrder([
        { id: "rpg", name: "RPG" },
        { id: "arcade", name: "Arcade" },
      ]),
      ["all", "favorites", "completed", "arcade", "rpg"]
    );
  });

  it("moves one tab at a time and stops at both boundaries", () => {
    const tabs = ["all", "favorites", "completed", "arcade"];

    assert.equal(getAdjacentLibraryTab(tabs, "all", -1), null);
    assert.equal(getAdjacentLibraryTab(tabs, "all", 1), "favorites");
    assert.equal(getAdjacentLibraryTab(tabs, "favorites", -1), "all");
    assert.equal(getAdjacentLibraryTab(tabs, "completed", 1), "arcade");
    assert.equal(getAdjacentLibraryTab(tabs, "arcade", 1), null);
  });

  it("recovers an invalid persisted tab at the first visible tab", () => {
    assert.equal(getAdjacentLibraryTab(["all", "favorites"], "gone", 1), "all");
    assert.equal(getAdjacentLibraryTab([], "gone", -1), null);
  });

  it("provides a complete D-pad path through nested console filters", () => {
    const parent = "console-parent";
    const selectedTab = "favorites-tab";
    const order = getLibraryConsoleFocusOrder(["n3ds", "switch"]);

    assert.deepEqual(order, [
      LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID,
      getLibraryFiltersConsolePillId("n3ds"),
      getLibraryFiltersConsolePillId("switch"),
    ]);
    assert.equal(
      getSelectedLibraryConsoleFocusId("switch", ["n3ds", "switch"]),
      getLibraryFiltersConsolePillId("switch")
    );
    assert.equal(
      getSelectedLibraryConsoleFocusId("ps2", ["n3ds", "switch"]),
      LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID
    );
    assert.deepEqual(
      getLibraryConsoleDirectionalTargets(order, 0, parent, selectedTab),
      {
        left: parent,
        right: getLibraryFiltersConsolePillId("n3ds"),
        up: parent,
        down: selectedTab,
      }
    );
    assert.deepEqual(
      getLibraryConsoleDirectionalTargets(order, 1, parent, selectedTab),
      {
        left: LIBRARY_FILTERS_CONSOLE_ALL_PILL_ID,
        right: getLibraryFiltersConsolePillId("switch"),
        up: parent,
        down: selectedTab,
      }
    );
    assert.deepEqual(
      getLibraryConsoleDirectionalTargets(order, 2, parent, selectedTab),
      {
        left: getLibraryFiltersConsolePillId("n3ds"),
        right: null,
        up: parent,
        down: selectedTab,
      }
    );
  });
});
