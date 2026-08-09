import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  getBigPictureDefaultPageTitle,
  getBigPictureSidebarItemIdFromPathname,
} from "./navigation";

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
