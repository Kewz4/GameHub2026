import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ShopAssets } from "@types";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import {
  doesArtworkMatchOrientation,
  getArtworkValidationSnapshot,
  getCarouselArtworkSources,
  useValidatedArtworkSource,
} from "./artwork";

const game: ShopAssets = {
  objectId: "620",
  shop: "steam",
  title: "Portal 2",
  iconUrl: "https://example.com/icon.png",
  libraryHeroImageUrl: "https://example.com/hero.jpg",
  libraryImageUrl: "https://example.com/library.jpg",
  logoImageUrl: null,
  logoPosition: null,
  coverImageUrl: "https://example.com/cover.jpg",
  downloadSources: [],
};

const carouselStyles = readFileSync(
  new URL("./styles.scss", import.meta.url),
  "utf8"
);

function readFluidWidth(variableName: string) {
  const match = new RegExp(
    `${variableName}: clamp\\((\\d+)px, (\\d+)vw, (\\d+)px\\)`
  ).exec(carouselStyles);

  assert.ok(match, `Missing fluid width token ${variableName}`);

  const [, minimum, viewportPercentage, maximum] = match;

  return (viewportWidth: number) =>
    Math.max(
      Number(minimum),
      Math.min(
        (viewportWidth * Number(viewportPercentage)) / 100,
        Number(maximum)
      )
    );
}

function ArtworkValidationProbe({
  sources,
}: Readonly<{ sources: readonly string[] }>) {
  const { activeSource, handleError, handleLoad, imageKey, isReady } =
    useValidatedArtworkSource({
      sources,
      orientation: "portrait",
    });

  if (!activeSource) return null;

  return createElement("img", {
    key: imageKey,
    src: activeSource,
    "data-artwork-ready": isReady ? "true" : undefined,
    onError: handleError,
    onLoad: handleLoad,
  });
}

function replaceGlobalProperty(name: "window" | "document", value: unknown) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, name, previousDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, name);
  };
}

function setDecodedImageSize(
  image: HTMLImageElement,
  naturalWidth: number,
  naturalHeight: number
) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: naturalWidth },
    naturalHeight: { configurable: true, value: naturalHeight },
  });
}

describe("Big Picture Home carousel artwork", () => {
  it("keeps landscape and portrait candidate lists separate", () => {
    assert.deepEqual(getCarouselArtworkSources(game, "landscape"), [
      game.libraryImageUrl,
      game.libraryHeroImageUrl,
      "https://cdn.akamai.steamstatic.com/steam/apps/620/header.jpg",
    ]);
    assert.deepEqual(getCarouselArtworkSources(game, "portrait"), [
      game.coverImageUrl,
      "https://cdn.akamai.steamstatic.com/steam/apps/620/library_600x900.jpg",
    ]);
  });

  it("does not reuse landscape artwork when a portrait is unavailable", () => {
    const portraitSources = getCarouselArtworkSources(
      {
        ...game,
        shop: "custom",
        objectId: "custom-game",
        coverImageUrl: null,
      },
      "portrait"
    );

    assert.deepEqual(portraitSources, []);
  });

  it("rejects decoded artwork whose dimensions do not match the slot", () => {
    assert.equal(doesArtworkMatchOrientation(460, 215, "landscape"), true);
    assert.equal(doesArtworkMatchOrientation(600, 900, "portrait"), true);
    assert.equal(doesArtworkMatchOrientation(460, 215, "portrait"), false);
    assert.equal(doesArtworkMatchOrientation(600, 900, "landscape"), false);
    assert.equal(doesArtworkMatchOrientation(512, 512, "portrait"), false);
  });

  it("invalidates readiness synchronously when the candidate list changes", () => {
    const previousValidation = {
      sourceKey: "old-cover.jpg\u0000old-fallback.jpg",
      sourceIndex: 1,
      readySource: "old-fallback.jpg",
    };

    assert.deepEqual(
      getArtworkValidationSnapshot(
        previousValidation,
        "new-cover.jpg\u0000new-fallback.jpg"
      ),
      {
        sourceKey: "new-cover.jpg\u0000new-fallback.jpg",
        sourceIndex: 0,
        readySource: null,
      }
    );
  });

  it("remounts an unchanged active URL when its fallback list changes", async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const restoreWindow = replaceGlobalProperty("window", dom.window);
    const restoreDocument = replaceGlobalProperty(
      "document",
      dom.window.document
    );
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

    try {
      const { createRoot } = await import("react-dom/client");
      const container = dom.window.document.querySelector("#root");
      assert.ok(container);
      const root = createRoot(container);
      const cover = "https://example.com/cover.jpg";

      await act(async () => {
        root.render(
          createElement(ArtworkValidationProbe, { sources: [cover] })
        );
      });

      const firstImage = container.querySelector("img");
      assert.ok(firstImage);
      setDecodedImageSize(firstImage, 600, 900);

      await act(async () => {
        firstImage.dispatchEvent(
          new dom.window.Event("load", { bubbles: true })
        );
      });
      assert.equal(firstImage.dataset.artworkReady, "true");

      await act(async () => {
        root.render(
          createElement(ArtworkValidationProbe, {
            sources: [cover, "https://example.com/fallback.jpg"],
          })
        );
      });

      const remountedImage = container.querySelector("img");
      assert.ok(remountedImage);
      assert.notEqual(remountedImage, firstImage);
      assert.equal(remountedImage.dataset.artworkReady, undefined);
      setDecodedImageSize(remountedImage, 600, 900);

      await act(async () => {
        remountedImage.dispatchEvent(
          new dom.window.Event("load", { bubbles: true })
        );
      });
      assert.equal(remountedImage.dataset.artworkReady, "true");

      await act(async () => root.unmount());
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      restoreDocument();
      restoreWindow();
      dom.window.close();
    }
  });

  it("keeps card widths continuous across the compact breakpoint", () => {
    const portraitWidth = readFluidWidth(
      "--focus-carousel-portrait-card-width"
    );
    const landscapeWidth = readFluidWidth(
      "--focus-carousel-landscape-card-width"
    );

    assert.ok(Math.abs(portraitWidth(720) - portraitWidth(721)) <= 1);
    assert.ok(Math.abs(landscapeWidth(720) - landscapeWidth(721)) <= 1);

    const compactMediaStyles = carouselStyles.slice(
      carouselStyles.indexOf("@media (max-width: 720px)")
    );
    assert.doesNotMatch(compactMediaStyles, /focus-carousel__slide/);
  });
});
