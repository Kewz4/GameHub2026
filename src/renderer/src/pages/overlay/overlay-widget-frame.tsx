import { EyeOff, Maximize2, MoreHorizontal, Move, Scaling } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `overlay-widget-options-${widgetId}`;
  const setWidgetRef = useCallback(
    (node: HTMLElement | null) => registerWidget(widgetId, node),
    [registerWidget, widgetId]
  );

  const closeOptions = useCallback((restoreFocus = true) => {
    setOptionsOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!optionsOpen) return;
    const measure = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!trigger || !menu) return;
      setMenuPosition({
        left: Math.max(
          8,
          Math.min(
            trigger.right - menu.width,
            window.innerWidth - menu.width - 8
          )
        ),
        top: Math.max(
          8,
          Math.min(trigger.bottom + 6, window.innerHeight - menu.height - 8)
        ),
      });
    };
    measure();
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [optionsOpen]);

  useEffect(() => {
    if (!optionsOpen) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        closeOptions(false);
      }
    };
    const onBlur = () => closeOptions(false);
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [closeOptions, optionsOpen]);

  const editWidget = (mode: OverlayWidgetControllerEditMode) => {
    closeOptions();
    onControllerEdit(widgetId, mode);
  };

  const overlayRoot = triggerRef.current?.closest(".overlay--full");

  return (
    <section
      ref={setWidgetRef}
      className={`overlay-card overlay-widget ${className}`.trim()}
      data-widget={widgetId}
      data-layout-locked={layoutLocked}
      aria-labelledby={`overlay-widget-title-${widgetId}`}
      style={widgetStyle}
      onPointerDown={() => onFocus(widgetId)}
    >
      <header
        className="overlay-card__head"
        onPointerDown={(event) => {
          if (
            !layoutLocked &&
            !(event.target as HTMLElement).closest("button, input, label")
          ) {
            onBeginDrag(widgetId, event);
          }
        }}
      >
        <div className="overlay-card__title">
          <span className="overlay-card__icon" aria-hidden="true">
            {icon}
          </span>
          <h2 id={`overlay-widget-title-${widgetId}`}>{title}</h2>
          {meta ? <span className="overlay-card__count">{meta}</span> : null}
        </div>
        <div className="overlay-card__tools">
          {headerActions}
          <button
            ref={triggerRef}
            type="button"
            className="overlay-widget__options-trigger"
            onClick={() => {
              if (optionsOpen) closeOptions();
              else setOptionsOpen(true);
            }}
            aria-label={`${title} widget options`}
            aria-expanded={optionsOpen}
            aria-controls={menuId}
            title={`${title} widget options`}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </header>
      {optionsOpen &&
        overlayRoot &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="overlay-widget-options"
            style={menuPosition}
            role="group"
            aria-label={`${title} widget options`}
            data-controller-scope="true"
            data-controller-dismiss-on-back="true"
          >
            {layoutLocked && <p>Unlock the layout to move or resize.</p>}
            <button
              type="button"
              data-widget-controller-edit="move"
              disabled={layoutLocked}
              aria-label={`Move ${title} widget`}
              aria-pressed={
                controllerEdit?.widgetId === widgetId &&
                controllerEdit.mode === "move"
              }
              onClick={() => editWidget("move")}
            >
              <Move size={16} />
              Move
            </button>
            <button
              type="button"
              data-widget-controller-edit="resize"
              disabled={layoutLocked}
              aria-label={`Resize ${title} widget`}
              aria-pressed={
                controllerEdit?.widgetId === widgetId &&
                controllerEdit.mode === "resize"
              }
              onClick={() => editWidget("resize")}
            >
              <Scaling size={16} />
              Resize
            </button>
            <button
              type="button"
              disabled={layoutLocked}
              aria-label={`Cycle ${title} widget size`}
              onClick={() => {
                closeOptions();
                onCycleSize(widgetId);
              }}
            >
              <Maximize2 size={16} />
              Cycle size
            </button>
            <button
              type="button"
              aria-label={`Hide ${title} widget`}
              onClick={() => {
                closeOptions(false);
                onHide(widgetId);
                document
                  .querySelector<HTMLButtonElement>(
                    ".overlay-header__widget-button"
                  )
                  ?.focus({ preventScroll: true });
              }}
            >
              <EyeOff size={16} />
              Hide widget
            </button>
          </div>,
          overlayRoot
        )}
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
