import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  getBigPictureContentEntryRegionIdFromPathname,
  getBigPictureDefaultPageTitle,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarItemIdFromPathname,
} from "./navigation";
import { GAME_ACHIEVEMENTS_PAGE_REGION_ID } from "../components/pages/game-achievements/navigation";

describe("Big Picture route presentation", () => {
  it("renders multi-word Cloud Saves without exposing the route slug", () => {
    assert.equal(
      getBigPictureDefaultPageTitle("/big-picture/cloud-saves"),
      "Cloud Saves"
    );
    assert.equal(
      getBigPictureDefaultPageTitle("/big-picture/downloads"),
      "Downloads"
    );
  });

  it("keeps Cloud Saves and Downloads as distinct active sidebar routes", () => {
    assert.equal(
      getBigPictureSidebarItemIdFromPathname("/big-picture/cloud-saves"),
      BIG_PICTURE_SIDEBAR_ITEM_IDS.cloudSaves
    );
    assert.equal(
      getBigPictureSidebarItemIdFromPathname("/big-picture/downloads"),
      BIG_PICTURE_SIDEBAR_ITEM_IDS.downloads
    );
  });

  it("maps the controller-only social routes exposed by the sidebar", () => {
    assert.equal(
      getBigPictureSidebarItemIdFromPathname("/big-picture/profile/user-1"),
      BIG_PICTURE_SIDEBAR_ITEM_IDS.profile
    );
    assert.equal(
      getBigPictureSidebarItemIdFromPathname("/big-picture/friends"),
      BIG_PICTURE_SIDEBAR_ITEM_IDS.friends
    );
  });

  it("keeps per-game achievements tied to the game and its own focus region", () => {
    assert.deepEqual(
      getBigPictureGameRouteMatch("/big-picture/game/steam/123/achievements"),
      {
        shop: "steam",
        objectId: "123",
        section: "achievements",
      }
    );
    assert.equal(
      getBigPictureSidebarItemIdFromPathname(
        "/big-picture/game/steam/123/achievements"
      ),
      null
    );
    assert.equal(
      getBigPictureContentEntryRegionIdFromPathname(
        "/big-picture/game/steam/123/achievements"
      ),
      GAME_ACHIEVEMENTS_PAGE_REGION_ID
    );
  });

  it("does not mark unrelated route names that merely share a prefix", () => {
    assert.equal(
      getBigPictureSidebarItemIdFromPathname("/big-picture/downloads-cloud"),
      BIG_PICTURE_SIDEBAR_ITEM_IDS.home
    );
    assert.equal(
      getBigPictureSidebarItemIdFromPathname("/big-picture/cloud-saves-old"),
      BIG_PICTURE_SIDEBAR_ITEM_IDS.home
    );
  });
});
