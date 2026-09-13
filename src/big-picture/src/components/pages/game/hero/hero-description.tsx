import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import cn from "classnames";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "../../../common";
import { useNavigationActions } from "../../../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import type { FocusOverrideTarget, FocusOverrides } from "../../../../services";
import { GAME_HERO_DESCRIPTION_TOGGLE_ID } from "../navigation";
import {
  createHeroDescriptionState,
  getHeroDescriptionPresentation,
  recordHeroDescriptionOverflow,
  resetHeroDescriptionState,
  sanitizeHeroDescriptionText,
  toggleHeroDescription,
} from "./hero-description-state";

const HERO_DESCRIPTION_ID = "game-hero-description";
const HERO_DESCRIPTION_OVERFLOW_TOLERANCE = 1;

interface HeroDescriptionProps {
  descriptionHtml: string;
  actionEntryTarget: FocusOverrideTarget;
  sidebarEntryTarget?: FocusOverrideTarget;
  onCanExpandChange: (canExpand: boolean) => void;
  onExpandedChange: (isExpanded: boolean) => void;
}

export function HeroDescription({
  descriptionHtml,
  actionEntryTarget,
  sidebarEntryTarget,
  onCanExpandChange,
  onExpandedChange,
}: Readonly<HeroDescriptionProps>) {
  const safeText = useMemo(
    () => sanitizeHeroDescriptionText(descriptionHtml),
    [descriptionHtml]
  );
  const [state, setState] = useState(createHeroDescriptionState);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const { setFocus } = useNavigationActions();
  const presentation = getHeroDescriptionPresentation(state);

  useEffect(() => {
    setState(resetHeroDescriptionState());
  }, [safeText]);

  useEffect(() => {
    onCanExpandChange(presentation.canExpand);
  }, [onCanExpandChange, presentation.canExpand]);

  useEffect(() => {
    onExpandedChange(presentation.isExpanded);
  }, [onExpandedChange, presentation.isExpanded]);

  useLayoutEffect(() => {
    const description = descriptionRef.current;
    if (!description || !safeText || state.isExpanded) return;

    const measureOverflow = () => {
      const isOverflowing =
        description.scrollHeight >
        description.clientHeight + HERO_DESCRIPTION_OVERFLOW_TOLERANCE;
      setState((current) =>
        recordHeroDescriptionOverflow(current, isOverflowing)
      );
    };

    const frameId = globalThis.window.requestAnimationFrame(measureOverflow);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureOverflow);
    resizeObserver?.observe(description);

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [safeText, state.isExpanded]);

  useEffect(
    () => () => {
      if (restoreFocusFrameRef.current !== null) {
        globalThis.window.cancelAnimationFrame(restoreFocusFrameRef.current);
      }
    },
    []
  );

  const handleToggle = useCallback(() => {
    const transition = toggleHeroDescription(state);
    if (transition.state === state) return;

    setState(transition.state);
    if (transition.restoreFocusId) {
      if (restoreFocusFrameRef.current !== null) {
        globalThis.window.cancelAnimationFrame(restoreFocusFrameRef.current);
      }
      restoreFocusFrameRef.current = globalThis.window.requestAnimationFrame(
        () => {
          setFocus(transition.restoreFocusId!);
          restoreFocusFrameRef.current = null;
        }
      );
    }
  }, [setFocus, state]);

  const focusNavigationOverrides = useMemo<FocusOverrides>(
    () => ({
      left: {
        type: "item",
        itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
      },
      right: sidebarEntryTarget ?? { type: "block" },
      up: { type: "block" },
      down: actionEntryTarget,
    }),
    [actionEntryTarget, sidebarEntryTarget]
  );

  if (!safeText) return null;

  return (
    <div className="game-page__hero-description-shell">
      <p
        ref={descriptionRef}
        id={HERO_DESCRIPTION_ID}
        className={cn(
          "typography typography--body",
          "game-page__hero-description",
          presentation.isExpanded && "game-page__hero-description--expanded"
        )}
        data-expanded={presentation.isExpanded}
      >
        {safeText}
      </p>

      {presentation.canExpand && (
        <Button
          focusId={GAME_HERO_DESCRIPTION_TOGGLE_ID}
          focusNavigationOverrides={focusNavigationOverrides}
          className="game-page__hero-description-toggle"
          variant="tertiary"
          size="small"
          icon={
            presentation.isExpanded ? (
              <CaretUpIcon size={16} weight="bold" />
            ) : (
              <CaretDownIcon size={16} weight="bold" />
            )
          }
          aria-controls={HERO_DESCRIPTION_ID}
          aria-expanded={presentation.isExpanded}
          data-state={presentation.isExpanded ? "expanded" : "collapsed"}
          onClick={handleToggle}
        >
          {presentation.toggleLabel}
        </Button>
      )}
    </div>
  );
}
