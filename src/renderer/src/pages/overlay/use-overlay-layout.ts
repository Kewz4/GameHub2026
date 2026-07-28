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
  /**
   * Widget dimensions are stored as fractions of the game window. This keeps a
   * layout usable when a player moves between 1080p, ultrawide and 4K games.
   */
  width: number;
  height: number;
  visible: boolean;
};

type OverlayLayout = Record<OverlayWidgetId, OverlayWidgetPosition>;

type WidgetSize = { width: number; height: number };

const LAYOUT_STORAGE_KEY = "gamehub.overlay.layout.v4";
const LEGACY_LAYOUT_STORAGE_KEYS = [
  "gamehub.overlay.layout.v3",
  "gamehub.overlay.layout.v2",
] as const;
const LAYOUT_LOCK_STORAGE_KEY = "gamehub.overlay.layout-locked.v1";

const DEFAULT_LAYOUT: OverlayLayout = {
  performance: {
    x: 0,
    y: 0.12,
    z: 2,
    width: 0.18,
    height: 0.2,
    visible: true,
  },
  achievements: {
    x: 0,
    y: 0.56,
    z: 3,
    width: 0.23,
    height: 0.38,
    visible: true,
  },
  capture: {
    x: 0.5,
    y: 0.12,
    z: 8,
    width: 0.3,
    height: 0.23,
    visible: true,
  },
  music: {
    x: 0.5,
    y: 1,
    z: 7,
    width: 0.42,
    height: 0.52,
    visible: true,
  },
  friends: {
    x: 1,
    y: 0.18,
    z: 4,
    width: 0.21,
    height: 0.31,
    visible: true,
  },
  mixer: {
    x: 1,
    y: 0.66,
    z: 5,
    width: 0.21,
    height: 0.28,
    visible: true,
  },
  "quick-launch": {
    x: 1,
    y: 1,
    z: 6,
    width: 0.26,
    height: 0.21,
    visible: true,
  },
  notes: {
    x: 0,
    y: 1,
    z: 1,
    width: 0.21,
    height: 0.2,
    visible: true,
  },
};

export const OVERLAY_WIDGET_IDS = Object.keys(
  DEFAULT_LAYOUT
) as OverlayWidgetId[];

const MIN_WIDGET_SIZE: Record<OverlayWidgetId, WidgetSize> = {
  performance: { width: 220, height: 150 },
  achievements: { width: 280, height: 230 },
  capture: { width: 360, height: 190 },
  music: { width: 420, height: 340 },
  friends: { width: 260, height: 210 },
  mixer: { width: 270, height: 190 },
  "quick-launch": { width: 290, height: 170 },
  notes: { width: 260, height: 150 },
};

const MINIMUM_SIZE_REFERENCE = { width: 1_080, height: 720 };
const MINIMUM_SIZE_SCALE_FLOOR = 0.7;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const getMinimumWidgetSize = (
  id: OverlayWidgetId,
  workspace: WidgetSize
): WidgetSize => {
  const scale = clamp(
    Math.min(
      workspace.width / MINIMUM_SIZE_REFERENCE.width,
      workspace.height / MINIMUM_SIZE_REFERENCE.height
    ),
    MINIMUM_SIZE_SCALE_FLOOR,
    1
  );
  const minimum = MIN_WIDGET_SIZE[id];
  return {
    width: Math.round(minimum.width * scale),
    height: Math.round(minimum.height * scale),
  };
};

const readStoredLayout = (): OverlayLayout => {
  try {
    const currentLayout = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    const legacyLayout = LEGACY_LAYOUT_STORAGE_KEYS.map((key) => ({
      key,
      value: window.localStorage.getItem(key),
    })).find(({ value }) => value !== null);
    const serialized = currentLayout ?? legacyLayout?.value ?? "{}";
    const stored = JSON.parse(serialized) as Partial<
      Record<OverlayWidgetId, Partial<OverlayWidgetPosition>>
    >;
    const migratesOverlappingMixerDefault =
      !currentLayout &&
      legacyLayout?.key === "gamehub.overlay.layout.v3" &&
      stored.mixer?.x === 1 &&
      stored.mixer?.y === 0.48 &&
      stored.mixer?.width === 0.21 &&
      stored.mixer?.height === 0.28;
    const migratesOverlappingAchievementsDefault =
      !currentLayout &&
      Boolean(legacyLayout) &&
      stored.achievements?.x === 0 &&
      stored.achievements?.y === 0.48;

    return OVERLAY_WIDGET_IDS.reduce((layout, id) => {
      const candidate = stored[id];
      const fallback = DEFAULT_LAYOUT[id];
      layout[id] = {
        x:
          typeof candidate?.x === "number" && Number.isFinite(candidate.x)
            ? clamp(candidate.x)
            : fallback.x,
        y:
          id === "mixer" && migratesOverlappingMixerDefault
            ? fallback.y
            : id === "achievements" && migratesOverlappingAchievementsDefault
              ? fallback.y
              : typeof candidate?.y === "number" && Number.isFinite(candidate.y)
                ? clamp(candidate.y)
                : fallback.y,
        z:
          typeof candidate?.z === "number" && Number.isFinite(candidate.z)
            ? Math.max(1, Math.round(candidate.z))
            : fallback.z,
        width:
          typeof candidate?.width === "number" &&
          Number.isFinite(candidate.width)
            ? clamp(candidate.width, 0.08, 0.95)
            : fallback.width,
        height:
          typeof candidate?.height === "number" &&
          Number.isFinite(candidate.height)
            ? clamp(candidate.height, 0.1, 0.95)
            : fallback.height,
        visible:
          typeof candidate?.visible === "boolean"
            ? candidate.visible
            : fallback.visible,
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
    width: Math.max(1, window.innerWidth - 24),
    height: Math.max(1, window.innerHeight - 24),
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
  const resize = useRef<{
    id: OverlayWidgetId;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    left: number;
    top: number;
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
      const changed = OVERLAY_WIDGET_IDS.some((id) => {
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
      const currentResize = resize.current;
      const workspace = workspaceRef.current;
      if (!workspace) return;

      if (currentResize) {
        const workspaceRect = workspace.getBoundingClientRect();
        const workspaceDimensions = {
          width: workspaceRect.width,
          height: workspaceRect.height,
        };
        const minimum = getMinimumWidgetSize(
          currentResize.id,
          workspaceDimensions
        );
        const minimumWidth = Math.min(minimum.width, workspaceRect.width);
        const minimumHeight = Math.min(minimum.height, workspaceRect.height);
        const fixedLeft = clamp(
          currentResize.left,
          0,
          Math.max(0, workspaceRect.width - minimumWidth)
        );
        const fixedTop = clamp(
          currentResize.top,
          0,
          Math.max(0, workspaceRect.height - minimumHeight)
        );
        const maxWidth = Math.max(
          minimumWidth,
          workspaceRect.width - fixedLeft
        );
        const maxHeight = Math.max(
          minimumHeight,
          workspaceRect.height - fixedTop
        );
        const width = clamp(
          currentResize.startWidth + event.clientX - currentResize.startX,
          minimumWidth,
          maxWidth
        );
        const height = clamp(
          currentResize.startHeight + event.clientY - currentResize.startY,
          minimumHeight,
          maxHeight
        );
        const availableX = Math.max(0, workspaceRect.width - width);
        const availableY = Math.max(0, workspaceRect.height - height);

        setLayout((current) => ({
          ...current,
          [currentResize.id]: {
            ...current[currentResize.id],
            x: availableX > 0 ? clamp(fixedLeft / availableX) : 0,
            y: availableY > 0 ? clamp(fixedTop / availableY) : 0,
            width: width / Math.max(1, workspaceRect.width),
            height: height / Math.max(1, workspaceRect.height),
          },
        }));
        return;
      }

      if (!currentDrag) return;

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
      resize.current = null;
      document.body.classList.remove(
        "overlay-widget-dragging",
        "overlay-widget-resizing"
      );
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.classList.remove(
        "overlay-widget-dragging",
        "overlay-widget-resizing"
      );
    };
  }, [workspaceRef]);

  const getWidgetStyle = useCallback(
    (id: OverlayWidgetId): CSSProperties => {
      const position = layout[id];
      const size = widgetSizes[id] ?? { width: 0, height: 0 };
      const minimum = getMinimumWidgetSize(id, workspaceSize);
      const width = clamp(
        position.width * workspaceSize.width,
        Math.min(minimum.width, workspaceSize.width),
        workspaceSize.width
      );
      const height = clamp(
        position.height * workspaceSize.height,
        Math.min(minimum.height, workspaceSize.height),
        workspaceSize.height
      );
      const actualWidth = size.width || width;
      const actualHeight = size.height || height;
      const availableX = Math.max(0, workspaceSize.width - actualWidth);
      const availableY = Math.max(0, workspaceSize.height - actualHeight);
      return {
        left: Math.round(position.x * availableX),
        top: Math.round(position.y * availableY),
        width: Math.round(width),
        height: Math.round(height),
        zIndex: position.z,
      };
    },
    [layout, widgetSizes, workspaceSize]
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
      resize.current = null;
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

  const beginWidgetResize = useCallback(
    (id: OverlayWidgetId, event: ReactPointerEvent<HTMLElement>) => {
      if (layoutLocked || event.button !== 0) return;

      const node = widgetNodes.current.get(id);
      const workspace = workspaceRef.current;
      if (!node || !workspace) return;

      event.preventDefault();
      event.stopPropagation();
      const nodeRect = node.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      drag.current = null;
      resize.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: nodeRect.width,
        startHeight: nodeRect.height,
        left: nodeRect.left - workspaceRect.left,
        top: nodeRect.top - workspaceRect.top,
      };
      document.body.classList.add("overlay-widget-resizing");
      focusWidget(id);
    },
    [focusWidget, layoutLocked, workspaceRef]
  );

  const cycleWidgetSize = useCallback(
    (id: OverlayWidgetId) => {
      setLayout((current) => {
        const item = current[id];
        const baseline = DEFAULT_LAYOUT[id];
        const currentScale = item.width / baseline.width;
        const nextScale =
          currentScale < 0.92 ? 1 : currentScale < 1.12 ? 1.25 : 0.78;
        return {
          ...current,
          [id]: {
            ...item,
            width: clamp(baseline.width * nextScale, 0.08, 0.95),
            height: clamp(baseline.height * nextScale, 0.1, 0.95),
          },
        };
      });
      focusWidget(id);
    },
    [focusWidget]
  );

  const setWidgetVisible = useCallback(
    (id: OverlayWidgetId, visible: boolean) => {
      setLayout((current) => ({
        ...current,
        [id]: { ...current[id], visible },
      }));
      if (visible) requestAnimationFrame(() => focusWidget(id));
    },
    [focusWidget]
  );

  const resetLayout = useCallback(() => {
    setLayout(
      OVERLAY_WIDGET_IDS.reduce((next, id) => {
        next[id] = { ...DEFAULT_LAYOUT[id] };
        return next;
      }, {} as OverlayLayout)
    );
  }, []);

  return {
    beginWidgetDrag,
    beginWidgetResize,
    cycleWidgetSize,
    focusWidget,
    getWidgetStyle,
    isWidgetVisible: (id: OverlayWidgetId) => layout[id].visible,
    layoutLocked,
    registerWidget,
    resetLayout,
    setLayoutLocked,
    setWidgetVisible,
  };
};
