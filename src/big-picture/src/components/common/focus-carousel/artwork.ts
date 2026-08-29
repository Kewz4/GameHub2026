import type { ShopAssets } from "@types";
import { useCallback, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";
import { resolveImageSource } from "../../../helpers";

export type CarouselArtworkOrientation = "landscape" | "portrait";

const MIN_LANDSCAPE_ASPECT_RATIO = 1.45;
const MAX_PORTRAIT_ASPECT_RATIO = 0.85;
const STEAM_CDN_BASE = "https://cdn.akamai.steamstatic.com/steam/apps";

const normalizeSources = (sources: ReadonlyArray<string | null | undefined>) =>
  sources
    .map((source) => resolveImageSource(source))
    .filter(
      (source, index, allSources) =>
        source.length > 0 && allSources.indexOf(source) === index
    );

const getSteamArtworkFallback = (
  game: Pick<ShopAssets, "objectId" | "shop">,
  orientation: CarouselArtworkOrientation
) => {
  if (game.shop !== "steam" || !/^\d+$/.test(game.objectId)) return null;

  const filename =
    orientation === "portrait" ? "library_600x900.jpg" : "header.jpg";

  return `${STEAM_CDN_BASE}/${game.objectId}/${filename}`;
};

/**
 * Keep each shelf's artwork source aligned with its physical card shape. The
 * cross-orientation fallbacks used by the generic image helpers are useful in
 * detail views, but turn a missing portrait into a severely cropped banner in
 * a fixed-ratio home shelf.
 */
export function getCarouselArtworkSources(
  game: Pick<
    ShopAssets,
    | "coverImageUrl"
    | "libraryHeroImageUrl"
    | "libraryImageUrl"
    | "objectId"
    | "shop"
  >,
  orientation: CarouselArtworkOrientation
) {
  const explicitSources =
    orientation === "portrait"
      ? [game.coverImageUrl]
      : [game.libraryImageUrl, game.libraryHeroImageUrl];

  return normalizeSources([
    ...explicitSources,
    getSteamArtworkFallback(game, orientation),
  ]);
}

export function doesArtworkMatchOrientation(
  naturalWidth: number,
  naturalHeight: number,
  orientation: CarouselArtworkOrientation
) {
  if (naturalWidth <= 0 || naturalHeight <= 0) return false;

  const aspectRatio = naturalWidth / naturalHeight;

  return orientation === "landscape"
    ? aspectRatio >= MIN_LANDSCAPE_ASPECT_RATIO
    : aspectRatio <= MAX_PORTRAIT_ASPECT_RATIO;
}

interface ValidatedArtworkSourceOptions {
  sources: readonly string[];
  orientation: CarouselArtworkOrientation;
  onExhausted?: () => void;
}

export interface ArtworkValidationState {
  sourceKey: string;
  sourceIndex: number;
  readySource: string | null;
}

export function getArtworkValidationSnapshot(
  state: Readonly<ArtworkValidationState>,
  sourceKey: string
): ArtworkValidationState {
  if (state.sourceKey === sourceKey) return { ...state };

  return {
    sourceKey,
    sourceIndex: 0,
    readySource: null,
  };
}

export function getArtworkImageKey(
  sourceKey: string,
  activeSource: string | null
) {
  return activeSource === null ? "" : `${sourceKey}\u0001${activeSource}`;
}

/**
 * Metadata occasionally puts a banner URL in coverImageUrl. Validate the real
 * decoded dimensions before revealing it and advance to the next candidate if
 * it does not match the shelf.
 */
export function useValidatedArtworkSource({
  sources,
  orientation,
  onExhausted,
}: Readonly<ValidatedArtworkSourceOptions>) {
  const sourceKey = sources.join("\u0000");
  const stableSources = useMemo(
    () => (sourceKey ? sourceKey.split("\u0000") : []),
    [sourceKey]
  );
  const [storedValidation, setStoredValidation] =
    useState<ArtworkValidationState>({
      sourceKey,
      sourceIndex: 0,
      readySource: null,
    });
  const validation = getArtworkValidationSnapshot(storedValidation, sourceKey);
  const activeSource = stableSources[validation.sourceIndex] ?? null;
  const isReady =
    activeSource !== null && validation.readySource === activeSource;
  const imageKey = getArtworkImageKey(sourceKey, activeSource);

  const rejectActiveSource = useCallback(() => {
    const nextIndex = validation.sourceIndex + 1;

    setStoredValidation({
      sourceKey,
      sourceIndex: nextIndex,
      readySource: null,
    });

    if (nextIndex >= stableSources.length) onExhausted?.();
  }, [onExhausted, sourceKey, stableSources.length, validation.sourceIndex]);

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const { naturalHeight, naturalWidth } = event.currentTarget;

      if (
        !doesArtworkMatchOrientation(naturalWidth, naturalHeight, orientation)
      ) {
        rejectActiveSource();
        return;
      }

      setStoredValidation({
        sourceKey,
        sourceIndex: validation.sourceIndex,
        readySource: activeSource,
      });
    },
    [
      activeSource,
      orientation,
      rejectActiveSource,
      sourceKey,
      validation.sourceIndex,
    ]
  );

  return {
    activeSource,
    imageKey,
    isReady,
    handleError: rejectActiveSource,
    handleLoad,
  };
}
