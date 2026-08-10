import { GrabberIcon } from "@primer/octicons-react";
import { EyeOff, Maximize2 } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
} from "react";

import type {
  OverlayWidgetControllerEditMode,
  OverlayWidgetId,
} from "./use-overlay-layout";

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
  controllerEdit: {
    widgetId: OverlayWidgetId;
    mode: OverlayWidgetControllerEditMode;
  } | null;
  onBeginDrag: (
    id: OverlayWidgetId,
    event: ReactPointerEvent<HTMLElement>
  ) => void;
  onBeginResize: (
    id: OverlayWidgetId,
    event: ReactPointerEvent<HTMLElement>
  ) => void;
  onCycleSize: (id: OverlayWidgetId) => void;
  onControllerEdit: (
    id: OverlayWidgetId,
    mode: OverlayWidgetControllerEditMode
  ) => void;
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
  controllerEdit,
  meta,
  onBeginDrag,
  onBeginResize,
  onCycleSize,
  onControllerEdit,
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
          <button
            type="button"
            className={`overlay-widget__drag ${layoutLocked ? "is-locked" : ""}`}
            data-widget-controller-edit="move"
            aria-label={`Move ${title} widget`}
            aria-pressed={
              controllerEdit?.widgetId === widgetId &&
              controllerEdit.mode === "move"
            }
            title={
              layoutLocked
                ? "Unlock the layout to move"
                : "Drag to move; press Enter or Select for move mode"
            }
            disabled={layoutLocked}
            onPointerDown={(event) => {
              event.stopPropagation();
              onBeginDrag(widgetId, event);
            }}
            onClick={(event) => {
              // Pointer dragging emits a click on release. Only keyboard and
              // programmatic/controller activation (detail 0) engage move mode.
              if (event.detail === 0) onControllerEdit(widgetId, "move");
            }}
          >
            <GrabberIcon size={16} />
          </button>
        </div>
      </header>
      {children}
      <button
        type="button"
        className={`overlay-widget__resize ${layoutLocked ? "is-locked" : ""}`}
        data-widget-controller-edit="resize"
        aria-label={`Resize ${title} widget`}
        aria-pressed={
          controllerEdit?.widgetId === widgetId &&
          controllerEdit.mode === "resize"
        }
        title={
          layoutLocked
            ? "Unlock the layout to resize"
            : "Drag to resize; press Enter or Select for resize mode"
        }
        disabled={layoutLocked}
        onPointerDown={(event) => onBeginResize(widgetId, event)}
        onClick={(event) => {
          if (event.detail === 0) onControllerEdit(widgetId, "resize");
        }}
      >
        <Maximize2 size={13} />
      </button>
    </section>
  );
};
