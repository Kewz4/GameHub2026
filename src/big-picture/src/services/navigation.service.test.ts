import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NavigationService, type FocusOverrides } from "./navigation.service";

function createNavigationWithNode(overrides: FocusOverrides) {
  const navigation = new NavigationService();

  navigation.registerLayer({
    id: "test-layer",
    rootRegionId: "root-region",
    isPersistent: true,
  });
  navigation.registerRegion({
    id: "root-region",
    parentRegionId: null,
    orientation: "horizontal",
    layerId: "test-layer",
    getElement: () => null,
  });
  navigation.registerRegion({
    id: "test-region",
    parentRegionId: "root-region",
    orientation: "vertical",
    layerId: "test-layer",
    getElement: () => null,
  });
  navigation.registerNavigationNode({
    id: "test-node",
    regionId: "test-region",
    layerId: "test-layer",
    navigationOverrides: overrides,
    getElement: () => null,
  });
  navigation.registerRegion({
    id: "target-region",
    parentRegionId: "root-region",
    orientation: "vertical",
    layerId: "test-layer",
    getElement: () => null,
  });
  navigation.registerNavigationNode({
    id: "first-item",
    regionId: "target-region",
    layerId: "test-layer",
    getElement: () => null,
  });
  navigation.registerNavigationNode({
    id: "second-item",
    regionId: "target-region",
    layerId: "test-layer",
    getElement: () => null,
  });

  return navigation;
}

describe("Big Picture navigation override updates", () => {
  it("updates remembered-focus policy when the target region stays the same", () => {
    const navigation = createNavigationWithNode({
      down: {
        type: "region",
        regionId: "target-region",
        preferRememberedFocus: true,
      },
    });

    navigation.updateNavigationNode("test-node", {
      navigationOverrides: {
        down: {
          type: "region",
          regionId: "target-region",
          preferRememberedFocus: false,
        },
      },
    });

    navigation.setFocus("second-item");
    navigation.setFocus("test-node");

    assert.equal(navigation.moveFocus("down"), "first-item");
  });

  it("updates an explicit initial focus item without changing regions", () => {
    const navigation = createNavigationWithNode({
      right: {
        type: "region",
        regionId: "target-region",
        initialFocusId: "first-item",
      },
    });

    navigation.updateNavigationNode("test-node", {
      navigationOverrides: {
        right: {
          type: "region",
          regionId: "target-region",
          initialFocusId: "second-item",
        },
      },
    });

    navigation.setFocus("test-node");

    assert.equal(navigation.moveFocus("right"), "second-item");
  });
});
