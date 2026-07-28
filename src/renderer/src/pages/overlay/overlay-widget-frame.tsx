import { GrabberIcon } from "@primer/octicons-react";
import { EyeOff, Maximize2 } from "lucide-react";
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
  onBeginResize: (
    id: OverlayWidgetId,
    event: ReactPointerEvent<HTMLElement>
  ) => void;
  onCycleSize: (id: OverlayWidgetId) => void;
  onFocus: (id: OverlayWidgetId) => void;
  onHide: (id: OverlayWidgetId) => void;
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
  onBeginResize,
  onCycleSize,
  onFocus,
  onHide,
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
          <button
            type="button"
            className="overlay-widget__tool"
            onClick={() => onCycleSize(widgetId)}
            aria-label={`Cycle ${title} widget size`}
            title="Cycle widget size"
            disabled={layoutLocked}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className="overlay-widget__tool"
            onClick={() => onHide(widgetId)}
            aria-label={`Hide ${title} widget`}
            title="Hide widget"
          >
            <EyeOff size={14} />
          </button>
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
      <span
        className={`overlay-widget__resize ${layoutLocked ? "is-locked" : ""}`}
        aria-hidden="true"
        title={layoutLocked ? "Unlock the layout to resize" : "Resize widget"}
        onPointerDown={(event) => onBeginResize(widgetId, event)}
      >
        <Maximize2 size={13} />
      </span>
    </section>
  );
};
