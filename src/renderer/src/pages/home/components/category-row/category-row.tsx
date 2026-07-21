import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { useVirtualizer } from "@tanstack/react-virtual";

import { GameCard } from "@renderer/components";
import type { ShopAssets } from "@types";
import { buildGameDetailsPath } from "@renderer/helpers";
import { getGameOrigin } from "@renderer/helpers/game-origin";
import { useAppSelector } from "@renderer/hooks";
import {
  type FeedbackKind,
  feedbackKey,
  getFeedbackMap,
  setFeedback,
} from "@renderer/pages/home/recommendation-feedback";

const EMPTY_SHOPS: string[] = [];

import { useDragScroll } from "./use-drag-scroll";
import "./category-row.scss";

interface Props {
  title: string;
  icon?: React.ReactNode;
  games: ShopAssets[];
  isLoading: boolean;
  /** Enables per-card like/dislike controls (the "Recommended for you" row). */
  enableFeedback?: boolean;
}

const SCROLL_STEP = 600;
/** Card width (280px) + track gap (16px) — the horizontal stride per card. */
const CARD_STRIDE = 296;

export const CategoryRow = memo(function CategoryRow({
  title,
  icon,
  games,
  isLoading,
  enableFeedback = false,
}: Readonly<Props>) {
  const navigate = useNavigate();
  const { ref, dragProps } = useDragScroll<HTMLDivElement>();

  // Subscribe to the library ONCE per row (not once per card) and derive the
  // synced-shop icons for just the games in this row. Rebuilds only when the
  // library reference actually changes.
  const library = useAppSelector((state) => state.library.value);
  const ownedShopsByObjectId = useMemo(() => {
    const wanted = new Set(games.map((g) => g.objectId));
    const map = new Map<string, string[]>();
    for (const g of library) {
      if (!wanted.has(g.objectId) || getGameOrigin(g) !== "sync") continue;
      const list = map.get(g.objectId);
      if (list) list.push(g.shop);
      else map.set(g.objectId, [g.shop]);
    }
    return map;
  }, [library, games]);

  const [feedback, setFeedbackState] = useState<Map<string, FeedbackKind>>(
    new Map()
  );

  useEffect(() => {
    if (!enableFeedback) return;
    let active = true;
    getFeedbackMap().then((map) => {
      if (!active) return;
      setFeedbackState(
        new Map([...map].map(([key, record]) => [key, record.feedback]))
      );
    });
    return () => {
      active = false;
    };
  }, [enableFeedback]);

  const handleFeedback = useCallback((game: ShopAssets, kind: FeedbackKind) => {
    const key = feedbackKey(game);
    setFeedbackState((prev) => {
      const next = new Map(prev);
      const nextKind = prev.get(key) === kind ? null : kind;
      if (nextKind) next.set(key, nextKind);
      else next.delete(key);
      void setFeedback(game, nextKind);
      return next;
    });
  }, []);

  const handleCardClick = useCallback(
    (game: ShopAssets) => {
      navigate(buildGameDetailsPath(game));
    },
    [navigate]
  );

  const scrollBy = useCallback(
    (delta: number) => {
      ref.current?.scrollBy({ left: delta, behavior: "smooth" });
    },
    [ref]
  );

  // Horizontally virtualize the track: only the cards near the viewport are
  // mounted, instead of all ~24 per row (×~10 rows = 200+ GameCards). This is
  // the fix `content-visibility` could not give — CSS skips off-screen PAINT
  // but React still mounted/laid-out every card. Now off-screen cards don't
  // exist in the tree at all until scrolled near.
  const virtualizer = useVirtualizer({
    count: games.length,
    horizontal: true,
    getScrollElement: () => ref.current,
    estimateSize: () => CARD_STRIDE,
    overscan: 3,
  });
  const virtualItems = virtualizer.getVirtualItems();

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
        {isLoading ? (
          Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="category-row__card-skeleton" />
          ))
        ) : (
          // Spacer sized to the full track width so the scrollbar/drag range is
          // correct; each visible card is absolutely positioned at its offset.
          <div
            className="category-row__virtual-sizer"
            style={{ width: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualItem) => {
              const game = games[virtualItem.index];
              return (
                <GameCard
                  key={`${game.shop}-${game.objectId}`}
                  game={game}
                  className="category-row__card"
                  style={{ transform: `translateX(${virtualItem.start}px)` }}
                  ownedShops={
                    ownedShopsByObjectId.get(game.objectId) ?? EMPTY_SHOPS
                  }
                  onCardClick={handleCardClick}
                  onCardFeedback={enableFeedback ? handleFeedback : undefined}
                  feedback={
                    enableFeedback
                      ? (feedback.get(feedbackKey(game)) ?? null)
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
});
