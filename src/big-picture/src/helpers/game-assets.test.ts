import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePreferredGameAssets } from "./index";

describe("Big Picture preferred game assets", () => {
  it("fills missing imported emulator artwork from current shop metadata", () => {
    const result = resolvePreferredGameAssets(
      {
        title: "Imported game",
        libraryHeroImageUrl: null,
        logoImageUrl: null,
        coverImageUrl: "library-cover",
      },
      {
        title: "Metadata title",
        libraryHeroImageUrl: "metadata-hero",
        logoImageUrl: "metadata-logo",
        coverImageUrl: "metadata-cover",
      }
    );

    assert.equal(result.title, "Imported game");
    assert.equal(result.heroSrc, "metadata-hero");
    assert.equal(result.logoSrc, "metadata-logo");
    assert.equal(result.coverSrc, "library-cover");
  });

  it("renders catalogue assets before a game has a library row", () => {
    const result = resolvePreferredGameAssets(null, {
      title: "Catalogue game",
      libraryHeroImageUrl: "catalogue-hero",
      libraryImageUrl: "catalogue-landscape",
      coverImageUrl: "catalogue-cover",
    });

    assert.equal(result.title, "Catalogue game");
    assert.equal(result.heroSrc, "catalogue-hero");
    assert.equal(result.coverSrc, "catalogue-cover");
  });
});
