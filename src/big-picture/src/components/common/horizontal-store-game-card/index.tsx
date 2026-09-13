import "./styles.scss";

import cn from "classnames";
import type { MouseEventHandler } from "react";
import { useValidatedArtworkSource } from "../focus-carousel/artwork";

export interface HorizontalStoreGameCardProps {
  coverImageUrls?: readonly string[];
  gameTitle: string;
  downloadSourceCount: number;
  forceHovered?: boolean;
  className?: string;
  onClick?: () => void;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  onCoverImageError?: () => void;
}

function getDownloadSourcesLabel(downloadSourceCount: number) {
  const normalizedCount = Math.max(0, downloadSourceCount);
  const suffix = normalizedCount === 1 ? "source" : "sources";

  return `${normalizedCount} download ${suffix}`;
}

export function HorizontalStoreGameCard({
  coverImageUrls = [],
  gameTitle,
  downloadSourceCount,
  forceHovered = false,
  className,
  onClick,
  onContextMenu,
  onCoverImageError,
}: Readonly<HorizontalStoreGameCardProps>) {
  const rootClassName = cn("horizontal-store-game-card", className, {
    "horizontal-store-game-card--force-hovered": forceHovered,
  });
  const TitleTag = onClick == null ? "h3" : "span";
  const { activeSource, handleError, handleLoad, imageKey, isReady } =
    useValidatedArtworkSource({
      sources: coverImageUrls,
      orientation: "landscape",
      onExhausted: onCoverImageError,
    });

  const inner = (
    <>
      <div
        className="horizontal-store-game-card__cover"
        data-artwork-orientation="landscape"
      >
        {activeSource ? (
          <img
            key={imageKey}
            src={activeSource}
            alt={gameTitle}
            draggable={false}
            data-artwork-ready={isReady || undefined}
            onError={handleError}
            onLoad={handleLoad}
          />
        ) : (
          <div
            className="horizontal-store-game-card__cover-placeholder"
            aria-hidden="true"
          />
        )}
      </div>

      <div className="horizontal-store-game-card__body">
        <TitleTag className="horizontal-store-game-card__title">
          {gameTitle}
        </TitleTag>
        <p className="horizontal-store-game-card__subtitle">
          {getDownloadSourcesLabel(downloadSourceCount)}
        </p>
      </div>
    </>
  );

  if (onClick == null) {
    return (
      <div className={rootClassName} onContextMenu={onContextMenu}>
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={rootClassName}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {inner}
    </button>
  );
}
