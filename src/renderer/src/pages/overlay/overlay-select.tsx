import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * Portal the open list up to the overlay root.
 *
 * A widget card sets `overflow: hidden` and `backdrop-filter`, and a
 * backdrop-filter makes the card the containing block for fixed-position
 * descendants — so a list rendered in place is clipped by the card no matter
 * its z-index. The overlay root is itself `position: fixed` with no transform
 * or filter, so a fixed list placed there is positioned against the viewport
 * and escapes every widget's clipping. It stays inside `.overlay--full`, which
 * is what controller focus traversal scans.
 */
const renderIntoOverlay = (
  from: HTMLElement | null,
  node: React.ReactNode
): React.ReactNode => {
  const host =
    from?.closest<HTMLElement>(".overlay--full") ??
    (typeof document === "undefined" ? null : document.body);
  return host ? createPortal(node, host) : node;
};

export type OverlaySelectOption<T extends string | number> = {
  value: T;
  label: string;
  disabled?: boolean;
};

interface OverlaySelectProps<T extends string | number> {
  value: T;
  options: OverlaySelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A select rendered entirely in the overlay's own DOM.
 *
 * A native `<select>` is unusable here: the overlay is a transparent,
 * always-on-top window over a fullscreen game, and Chromium hands the dropdown
 * to the OS as its own popup window. That popup is not part of the overlay's
 * always-on-top group, so over an exclusive-fullscreen game it is composited
 * underneath — the list appeared behind the overlay and could not be clicked.
 *
 * It also behaves better on a controller than a native popup: with the trigger
 * focused, left/right cycle the value without opening anything, while A/Enter
 * opens the list for direct selection.
 */
export function OverlaySelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
}: OverlaySelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const enabled = options.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(
    0,
    enabled.findIndex((option) => option.value === value)
  );

  const commit = useCallback(
    (next: T) => {
      if (next !== value) onChange(next);
      setOpen(false);
    },
    [onChange, value]
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      if (!enabled.length) return;
      const next =
        enabled[
          Math.min(enabled.length - 1, Math.max(0, selectedIndex + direction))
        ];
      if (next && next.value !== value) onChange(next.value);
    },
    [enabled, onChange, selectedIndex, value]
  );

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  // Close when focus or a click lands outside; the overlay has no backdrop to
  // catch this for us.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // The list is portaled out of the widget, so its position is measured from
  // the trigger. Flip above the trigger when there is no room below.
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const estimatedHeight = Math.min(260, Math.max(80, options.length * 34));
      const spaceBelow = window.innerHeight - rect.bottom;
      const flip = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      setAnchor({
        left: rect.left,
        top: flip
          ? Math.max(8, rect.top - estimatedHeight - 6)
          : rect.bottom + 6,
        width: rect.width,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, options.length]);

  return (
    <div
      ref={rootRef}
      className={`overlay-select ${open ? "is-open" : ""} ${className ?? ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="overlay-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(-1);
          } else if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span className="overlay-select__value">
          {selected?.label ?? String(value)}
        </span>
        <span className="overlay-select__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open &&
        anchor &&
        renderIntoOverlay(
          rootRef.current,
          <div
            ref={listRef}
            className="overlay-select__list"
            role="listbox"
            id={listId}
            tabIndex={-1}
            style={{
              left: `${anchor.left}px`,
              top: `${anchor.top}px`,
              minWidth: `${anchor.width}px`,
            }}
          >
            {options.map((option) => {
              const enabledIndex = enabled.findIndex(
                (candidate) => candidate.value === option.value
              );
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  data-active={
                    enabledIndex === activeIndex ? "true" : undefined
                  }
                  className={`overlay-select__option ${
                    option.value === value ? "is-selected" : ""
                  }`}
                  disabled={option.disabled}
                  onClick={() => commit(option.value)}
                  onMouseEnter={() =>
                    enabledIndex >= 0 && setActiveIndex(enabledIndex)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                    }
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}
