import { GrabberIcon } from "@primer/octicons-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
} from "react";

import type { OverlayWidgetId } from "./use-overlay-layout";

type OverlayWidgetFrameProps = {
  children: ReactNode;
  className?: string;
  headerActions?: ReactNode;
  icon: ReactNode;
  meta?: ReactNode;
  title: string;
  widgetId: OverlayWidgetId;
  widgetStyle: CSSProperties;
  layoutLocked: boolean;
  onBeginDrag: (
    id: OverlayWidgetId,
    event: ReactPointerEvent<HTMLElement>
  ) => void;
  onFocus: (id: OverlayWidgetId) => void;
  registerWidget: (id: OverlayWidgetId, node: HTMLElement | null) => void;
};

export const OverlayWidgetFrame = ({
  children,
  className = "",
  headerActions,
  icon,
  layoutLocked,
  meta,
  onBeginDrag,
  onFocus,
  registerWidget,
  title,
  widgetId,
  widgetStyle,
}: OverlayWidgetFrameProps) => {
  const setWidgetRef = useCallback(
    (node: HTMLElement | null) => registerWidget(widgetId, node),
    [registerWidget, widgetId]
  );

  return (
    <section
      ref={setWidgetRef}
      className={`overlay-card overlay-widget ${className}`.trim()}
      data-widget={widgetId}
      style={widgetStyle}
      onPointerDown={() => onFocus(widgetId)}
    >
      <header className="overlay-card__head">
        <div className="overlay-card__title">
          <span className="overlay-card__icon" aria-hidden="true">
            {icon}
          </span>
          <h2>{title}</h2>
          {meta ? <span className="overlay-card__count">{meta}</span> : null}
        </div>
        <div className="overlay-card__tools">
          {headerActions}
          <span
            className={`overlay-widget__drag ${layoutLocked ? "is-locked" : ""}`}
            aria-hidden="true"
            title={layoutLocked ? "Unlock the layout to move" : "Drag widget"}
            onPointerDown={(event) => {
              event.stopPropagation();
              onBeginDrag(widgetId, event);
            }}
          >
            <GrabberIcon size={16} />
          </span>
        </div>
      </header>
      {children}
    </section>
  );
};
