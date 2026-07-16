import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { GameCard } from "@renderer/components";
import type { ShopAssets } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";

import { useDragScroll } from "./use-drag-scroll";
import "./category-row.scss";

interface Props {
  title: string;
  icon?: React.ReactNode;
  games: ShopAssets[];
  isLoading: boolean;
}

const SCROLL_STEP = 600;

export function CategoryRow({
  title,
  icon,
  games,
  isLoading,
}: Readonly<Props>) {
  const navigate = useNavigate();
  const { ref, dragProps } = useDragScroll<HTMLDivElement>();

  const scrollBy = useCallback(
    (delta: number) => {
      ref.current?.scrollBy({ left: delta, behavior: "smooth" });
    },
    [ref]
  );

  if (!isLoading && games.length === 0) return null;

  return (
    <section className="category-row" aria-label={title}>
      <header className="category-row__header">
        <h2 className="category-row__title">
          {icon}
          {title}
        </h2>
        {/* Explicit, keyboard-accessible scroll controls (the track also
            scrolls natively with the arrow keys once focused). */}
        <div className="category-row__nav">
          <button
            type="button"
            className="category-row__nav-button"
            aria-label={`Scroll ${title} left`}
            onClick={() => scrollBy(-SCROLL_STEP)}
          >
            <ChevronLeftIcon size={16} />
          </button>
          <button
            type="button"
            className="category-row__nav-button"
            aria-label={`Scroll ${title} right`}
            onClick={() => scrollBy(SCROLL_STEP)}
          >
            <ChevronRightIcon size={16} />
          </button>
        </div>
      </header>

      {/* Native horizontal scroll container: focusable so arrow keys pan it,
          with pointer-event drag layered on. No wheel listeners. A scroll
          region is a legitimate focusable non-interactive element. */}
      <div
        className="category-row__track"
        ref={ref}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="group"
        aria-label={title}
        {...dragProps}
      >
        {isLoading
          ? Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="category-row__card-skeleton" />
            ))
          : games.map((game) => (
              <GameCard
                key={`${game.shop}-${game.objectId}`}
                game={game}
                className="category-row__card"
                onClick={() => navigate(buildGameDetailsPath(game))}
              />
            ))}
      </div>
    </section>
  );
}
