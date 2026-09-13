import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getBigPictureCurrentPageTitle,
  isSameBigPictureNavigationLocation,
} from "./route-presentation";

describe("Big Picture route-owned header title", () => {
  it("keeps localized Cloud Saves through direct routing, rerenders, resize, and revisit state", () => {
    const pathname = "/big-picture/cloud-saves";
    const routeOwnedTitles = { cloudSaves: "Partidas en la nube" };
    const renderCycles = [
      undefined,
      { pathname, title: "Hades II" },
      { pathname: "/big-picture/game/steam/1145350", title: "Hades II" },
      { pathname: "/big-picture/cloud-saves/", title: "Hades II" },
    ];

    for (const historyEntry of renderCycles) {
      assert.equal(
        getBigPictureCurrentPageTitle(pathname, historyEntry, routeOwnedTitles),
        "Partidas en la nube"
      );
    }
  });

  it("distinguishes direct hash routes when the browser reuses its default key", () => {
    const browserKey = "default";

    assert.equal(
      isSameBigPictureNavigationLocation(
        {
          key: browserKey,
          pathname: "/big-picture/game/steam/1145350",
        },
        { key: browserKey, pathname: "/big-picture/cloud-saves" }
      ),
      false
    );
    assert.equal(
      isSameBigPictureNavigationLocation(
        { key: browserKey, pathname: "/big-picture/cloud-saves/" },
        { key: browserKey, pathname: "/big-picture/cloud-saves" }
      ),
      true
    );
  });
});
