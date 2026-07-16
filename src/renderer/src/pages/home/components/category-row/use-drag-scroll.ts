import { useCallback, useRef } from "react";

/**
 * Drag-to-scroll for a horizontally-scrolling container, using POINTER events
 * (which are passive by nature — no non-passive wheel listeners, no capture
 * phase, nothing attached to the document). Returns a ref for the scroll
 * container plus the handlers to spread onto it. Native trackpad/shift-wheel
 * horizontal scrolling keeps working untouched; this only adds click-and-drag.
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const state = useRef({ down: false, startX: 0, startLeft: 0, moved: false });

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    // Only primary button, and ignore drags starting on interactive controls
    // handled by their own logic.
    if (e.button !== 0 || !ref.current) return;
    state.current = {
      down: true,
      startX: e.clientX,
      startLeft: ref.current.scrollLeft,
      moved: false,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const s = state.current;
    if (!s.down || !ref.current) return;
    const dx = e.clientX - s.startX;
    if (Math.abs(dx) > 4) {
      s.moved = true;
      ref.current.setPointerCapture?.(e.pointerId);
    }
    if (s.moved) ref.current.scrollLeft = s.startLeft - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<T>) => {
    if (state.current.moved) ref.current?.releasePointerCapture?.(e.pointerId);
    state.current.down = false;
  }, []);

  // Swallow the click that follows a real drag so it doesn't open a game.
  const onClickCapture = useCallback((e: React.MouseEvent<T>) => {
    if (state.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      state.current.moved = false;
    }
  }, []);

  return {
    ref,
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
      onClickCapture,
    },
  };
}
