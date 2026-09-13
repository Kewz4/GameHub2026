import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

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
 * It also behaves better on a controller than a native popup: A/Enter engages
 * the list, directions choose an option, and B/Escape disengages. Directions
 * do not mutate the value before engagement, so the control cannot trap XY
 * focus navigation.
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

  const focusOption = useCallback(
    (index: number) => {
      if (!enabled.length) return;
      const nextIndex = (index + enabled.length) % enabled.length;
      setActiveIndex(nextIndex);
      window.requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(
            `[data-overlay-select-index="${nextIndex}"]`
          )
          ?.focus({ preventScroll: true });
      });
    },
    [enabled.length]
  );

  const close = useCallback((restoreTriggerFocus = false) => {
    setOpen(false);
    if (restoreTriggerFocus) {
      window.requestAnimationFrame(() =>
        triggerRef.current?.focus({ preventScroll: true })
      );
    }
  }, []);

  const handoffTab = useCallback(
    (backward: boolean) => {
      const trigger = triggerRef.current;
      const overlay = trigger?.closest<HTMLElement>(".overlay--full");
      if (!trigger || !overlay) {
        close(true);
        return;
      }
      const candidates = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      ).filter((element) => {
        if (
          listRef.current?.contains(element) ||
          element.closest('[aria-hidden="true"], [inert], [hidden]')
        ) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      const triggerIndex = candidates.indexOf(trigger);
      const target =
        triggerIndex < 0 || candidates.length < 2
          ? trigger
          : candidates[
              (triggerIndex + (backward ? -1 : 1) + candidates.length) %
                candidates.length
            ];
      close();
      window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
    },
    [close]
  );

  const openList = useCallback(() => {
    // Seed the active option before the portaled list mounts. Updating it in
    // an effect leaves one frame where the first option receives focus, so a
    // fast keyboard/controller direction can step from the wrong value.
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [selectedIndex]);

  const commit = useCallback(
    (next: T) => {
      if (next !== value) onChange(next);
      close(true);
    },
    [close, onChange, value]
  );

  // Close when focus or a click lands outside; the overlay has no backdrop to
  // catch this for us.
  useEffect(() => {
    if (!open) return;
    const isInsideSelect = (target: EventTarget | null) =>
      target instanceof Node &&
      (Boolean(rootRef.current?.contains(target)) ||
        Boolean(listRef.current?.contains(target)));
    const onPointerDown = (event: PointerEvent) => {
      if (!isInsideSelect(event.target)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isInsideSelect(event.target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open || !anchor) return;
    const frame = window.requestAnimationFrame(() => {
      const activeOption = listRef.current?.querySelector<HTMLElement>(
        `[data-overlay-select-index="${activeIndex}"]`
      );
      activeOption?.scrollIntoView({ block: "nearest" });
      activeOption?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex, anchor, open]);

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
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            openList();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <span className="overlay-select__value">
          {selected?.label ?? String(value)}
        </span>
        <ChevronDown
          className="overlay-select__caret"
          size={13}
          aria-hidden="true"
        />
      </button>

      {open &&
        anchor &&
        renderIntoOverlay(
          rootRef.current,
          <div
            ref={listRef}
            className="overlay-select__list"
            data-controller-scope="true"
            role="listbox"
            id={listId}
            aria-label={ariaLabel}
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
                  data-overlay-select-index={
                    enabledIndex >= 0 ? enabledIndex : undefined
                  }
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
                    if (
                      event.key === "ArrowDown" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      focusOption(enabledIndex + 1);
                    } else if (
                      event.key === "ArrowUp" ||
                      event.key === "ArrowLeft"
                    ) {
                      event.preventDefault();
                      focusOption(enabledIndex - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      focusOption(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      focusOption(enabled.length - 1);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      commit(option.value);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      close(true);
                    } else if (event.key === "Tab") {
                      event.preventDefault();
                      event.stopPropagation();
                      handoffTab(event.shiftKey);
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
