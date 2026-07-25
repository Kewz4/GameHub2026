import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type OverlayWidgetId =
  | "performance"
  | "achievements"
  | "capture"
  | "music"
  | "friends"
  | "mixer"
  | "quick-launch"
  | "notes";

type OverlayWidgetPosition = {
  /**
   * Normalized position within the widget's available travel area. Keeping
   * these values resolution-independent prevents a layout created at 4K from
   * disappearing off-screen when the next game runs at 1080p.
   */
  x: number;
  y: number;
  z: number;
};

type OverlayLayout = Record<OverlayWidgetId, OverlayWidgetPosition>;

type WidgetSize = { width: number; height: number };

const LAYOUT_STORAGE_KEY = "gamehub.overlay.layout.v2";
const LAYOUT_LOCK_STORAGE_KEY = "gamehub.overlay.layout-locked.v1";

const DEFAULT_LAYOUT: OverlayLayout = {
  performance: { x: 0, y: 0, z: 2 },
  achievements: { x: 0, y: 0.48, z: 3 },
  capture: { x: 0.5, y: 0, z: 8 },
  music: { x: 0.5, y: 1, z: 7 },
  friends: { x: 1, y: 0, z: 4 },
  mixer: { x: 1, y: 0.48, z: 5 },
  "quick-launch": { x: 1, y: 1, z: 6 },
  notes: { x: 0, y: 1, z: 1 },
};

const WIDGET_IDS = Object.keys(DEFAULT_LAYOUT) as OverlayWidgetId[];

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const readStoredLayout = (): OverlayLayout => {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}"
    ) as Partial<Record<OverlayWidgetId, Partial<OverlayWidgetPosition>>>;

    return WIDGET_IDS.reduce((layout, id) => {
      const candidate = stored[id];
      const fallback = DEFAULT_LAYOUT[id];
      layout[id] = {
        x:
          typeof candidate?.x === "number" && Number.isFinite(candidate.x)
            ? clamp(candidate.x)
            : fallback.x,
        y:
          typeof candidate?.y === "number" && Number.isFinite(candidate.y)
            ? clamp(candidate.y)
            : fallback.y,
        z:
          typeof candidate?.z === "number" && Number.isFinite(candidate.z)
            ? Math.max(1, Math.round(candidate.z))
            : fallback.z,
      };
      return layout;
    }, {} as OverlayLayout);
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
};

const readLayoutLock = () => {
  try {
    return window.localStorage.getItem(LAYOUT_LOCK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const useOverlayLayout = (workspaceRef: RefObject<HTMLDivElement>) => {
  const [layout, setLayout] = useState<OverlayLayout>(readStoredLayout);
  const [layoutLocked, setLayoutLocked] = useState(readLayoutLock);
  const [workspaceSize, setWorkspaceSize] = useState<WidgetSize>({
    width: 0,
    height: 0,
  });
  const [widgetSizes, setWidgetSizes] = useState<
    Partial<Record<OverlayWidgetId, WidgetSize>>
  >({});

  const widgetNodes = useRef(new Map<OverlayWidgetId, HTMLElement>());
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const drag = useRef<{
    id: OverlayWidgetId;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const measure = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const workspaceRect = workspace.getBoundingClientRect();
    const nextWorkspaceSize = {
      width: Math.max(0, workspaceRect.width),
      height: Math.max(0, workspaceRect.height),
    };
    setWorkspaceSize((current) =>
      current.width === nextWorkspaceSize.width &&
      current.height === nextWorkspaceSize.height
        ? current
        : nextWorkspaceSize
    );

    const nextWidgetSizes: Partial<Record<OverlayWidgetId, WidgetSize>> = {};
    for (const [id, node] of widgetNodes.current) {
      const rect = node.getBoundingClientRect();
      nextWidgetSizes[id] = {
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      };
    }
    setWidgetSizes((current) => {
      const changed = WIDGET_IDS.some((id) => {
        const before = current[id];
        const after = nextWidgetSizes[id];
        return (
          before?.width !== after?.width || before?.height !== after?.height
        );
      });
      return changed ? nextWidgetSizes : current;
    });
  }, [workspaceRef]);

  const registerWidget = useCallback(
    (id: OverlayWidgetId, node: HTMLElement | null) => {
      const previous = widgetNodes.current.get(id);
      if (previous && previous !== node) {
        resizeObserver.current?.unobserve(previous);
      }

      if (node) {
        widgetNodes.current.set(id, node);
        resizeObserver.current?.observe(node);
      } else {
        widgetNodes.current.delete(id);
      }

      requestAnimationFrame(measure);
    },
    [measure]
  );

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    resizeObserver.current = observer;

    const workspace = workspaceRef.current;
    if (workspace) observer.observe(workspace);
    for (const node of widgetNodes.current.values()) observer.observe(node);
    measure();

    return () => {
      observer.disconnect();
      resizeObserver.current = null;
    };
  }, [measure, workspaceRef]);

  useEffect(() => {
    const save = window.setTimeout(() => {
      try {
        window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
      } catch {
        // A read-only session should not make the overlay unusable.
      }
    }, 120);
    return () => window.clearTimeout(save);
  }, [layout]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAYOUT_LOCK_STORAGE_KEY,
        String(layoutLocked)
      );
    } catch {
      // A read-only session should not make the overlay unusable.
    }
  }, [layoutLocked]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const currentDrag = drag.current;
      const workspace = workspaceRef.current;
      if (!currentDrag || !workspace) return;

      const node = widgetNodes.current.get(currentDrag.id);
      if (!node) return;

      const workspaceRect = workspace.getBoundingClientRect();
      const widgetRect = node.getBoundingClientRect();
      const availableX = Math.max(0, workspaceRect.width - widgetRect.width);
      const availableY = Math.max(0, workspaceRect.height - widgetRect.height);
      const left = clamp(
        event.clientX - workspaceRect.left - currentDrag.offsetX,
        0,
        availableX
      );
      const top = clamp(
        event.clientY - workspaceRect.top - currentDrag.offsetY,
        0,
        availableY
      );

      setLayout((current) => ({
        ...current,
        [currentDrag.id]: {
          ...current[currentDrag.id],
          x: availableX > 0 ? left / availableX : 0,
          y: availableY > 0 ? top / availableY : 0,
        },
      }));
    };

    const handlePointerUp = () => {
      drag.current = null;
      document.body.classList.remove("overlay-widget-dragging");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.classList.remove("overlay-widget-dragging");
    };
  }, [workspaceRef]);

  const getWidgetStyle = useCallback(
    (id: OverlayWidgetId): CSSProperties => {
      const position = layout[id];
      const size = widgetSizes[id] ?? { width: 0, height: 0 };
      const availableX = Math.max(0, workspaceSize.width - size.width);
      const availableY = Math.max(0, workspaceSize.height - size.height);
      return {
        left: Math.round(position.x * availableX),
        top: Math.round(position.y * availableY),
        zIndex: position.z,
      };
    },
    [layout, widgetSizes, workspaceSize]
  );

  const beginWidgetDrag = useCallback(
    (id: OverlayWidgetId, event: ReactPointerEvent<HTMLElement>) => {
      if (layoutLocked || event.button !== 0) return;

      const node = widgetNodes.current.get(id);
      const workspace = workspaceRef.current;
      if (!node || !workspace) return;

      event.preventDefault();
      const nodeRect = node.getBoundingClientRect();
      drag.current = {
        id,
        offsetX: event.clientX - nodeRect.left,
        offsetY: event.clientY - nodeRect.top,
      };
      document.body.classList.add("overlay-widget-dragging");

      setLayout((current) => {
        const highestZ = Math.max(
          ...Object.values(current).map((item) => item.z)
        );
        if (current[id].z === highestZ) return current;
        return {
          ...current,
          [id]: { ...current[id], z: highestZ + 1 },
        };
      });
    },
    [layoutLocked, workspaceRef]
  );

  const focusWidget = useCallback((id: OverlayWidgetId) => {
    setLayout((current) => {
      const highestZ = Math.max(
        ...Object.values(current).map((item) => item.z)
      );
      if (current[id].z === highestZ) return current;
      return {
        ...current,
        [id]: { ...current[id], z: highestZ + 1 },
      };
    });
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(
      WIDGET_IDS.reduce((next, id) => {
        next[id] = { ...DEFAULT_LAYOUT[id] };
        return next;
      }, {} as OverlayLayout)
    );
  }, []);

  return {
    beginWidgetDrag,
    focusWidget,
    getWidgetStyle,
    layoutLocked,
    registerWidget,
    resetLayout,
    setLayoutLocked,
  };
};
