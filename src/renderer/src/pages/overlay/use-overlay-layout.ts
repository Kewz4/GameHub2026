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

export type OverlayWidgetControllerEditMode = "move" | "resize";
export type OverlayWidgetControllerDirection = "up" | "down" | "left" | "right";

export type OverlayWidgetPosition = {
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

export type OverlayBlockedRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type OverlayWidgetPixelBounds = WidgetSize & {
  left: number;
  top: number;
};

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
    y: 0.6,
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

// These two cards have intrinsic content floors in overlay.scss. Keep the
// layout engine aware of them so normalized positioning uses the rendered
// height instead of a smaller theoretical height at compact resolutions.
const ABSOLUTE_MIN_WIDGET_SIZE: Partial<
  Record<OverlayWidgetId, Partial<WidgetSize>>
> = {
  performance: { height: 174 },
  capture: { height: 196 },
};

const DEFAULT_LAYOUT_COLUMNS: ReadonlyArray<ReadonlyArray<OverlayWidgetId>> = [
  ["performance", "achievements", "notes"],
  ["capture", "music"],
  ["friends", "mixer", "quick-launch"],
];
const DEFAULT_WIDGET_GAP = 8;

const MINIMUM_SIZE_REFERENCE = { width: 1_080, height: 720 };
const MINIMUM_SIZE_SCALE_FLOOR = 0.7;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const rectsOverlap = (left: OverlayBlockedRect, right: OverlayBlockedRect) =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top;

/**
 * Keeps the widget's title/tool strip out from under floating global controls.
 * Only the occupied header docks are treated as blocked, so the center and all
 * lower edges remain a genuinely freeform workspace.
 */
export const recoverOverlayWidgetControls = (
  bounds: OverlayWidgetPixelBounds,
  workspace: WidgetSize,
  blockedRects: ReadonlyArray<OverlayBlockedRect>,
  gap = 8
): OverlayWidgetPixelBounds => {
  const width = clamp(bounds.width, 1, workspace.width);
  const height = clamp(bounds.height, 1, workspace.height);
  const initial = {
    left: clamp(bounds.left, 0, Math.max(0, workspace.width - width)),
    top: clamp(bounds.top, 0, Math.max(0, workspace.height - height)),
    width,
    height,
  };
  const headerRect = (candidate: OverlayWidgetPixelBounds) => ({
    left: candidate.left,
    top: candidate.top,
    right: candidate.left + candidate.width,
    bottom: candidate.top + Math.min(48, candidate.height),
  });
  const isReachable = (candidate: OverlayWidgetPixelBounds) =>
    !blockedRects.some((blocked) =>
      rectsOverlap(headerRect(candidate), blocked)
    );
  if (isReachable(initial)) return initial;

  const candidatePositions = blockedRects.flatMap((blocked) => [
    { left: initial.left, top: blocked.bottom + gap },
    { left: blocked.left - initial.width - gap, top: initial.top },
    { left: blocked.right + gap, top: initial.top },
  ]);
  const candidates = candidatePositions
    .map(({ left, top }) => {
      const nextLeft = clamp(
        left,
        0,
        Math.max(0, workspace.width - initial.width)
      );
      const nextTop = clamp(top, 0, Math.max(0, workspace.height - 1));
      return {
        left: nextLeft,
        top: nextTop,
        width: initial.width,
        // A nearly full-height widget is shortened only when that is the sole
        // way to preserve an accessible title/tool strip below a header dock.
        height: Math.min(initial.height, workspace.height - nextTop),
      };
    })
    .filter((candidate) => candidate.height > 0 && isReachable(candidate))
    .sort((left, right) => {
      const leftDistance =
        Math.abs(left.left - initial.left) +
        Math.abs(left.top - initial.top) +
        Math.abs(left.height - initial.height) * 2;
      const rightDistance =
        Math.abs(right.left - initial.left) +
        Math.abs(right.top - initial.top) +
        Math.abs(right.height - initial.height) * 2;
      return leftDistance - rightDistance;
    });

  return candidates[0] ?? initial;
};

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
  const absoluteMinimum = ABSOLUTE_MIN_WIDGET_SIZE[id];
  return {
    width: Math.max(
      absoluteMinimum?.width ?? 0,
      Math.round(minimum.width * scale)
    ),
    height: Math.max(
      absoluteMinimum?.height ?? 0,
      Math.round(minimum.height * scale)
    ),
  };
};

const getOverlayWidgetPixelBounds = (
  id: OverlayWidgetId,
  position: OverlayWidgetPosition,
  workspace: WidgetSize,
  blockedRects: ReadonlyArray<OverlayBlockedRect>
) => {
  const minimum = getMinimumWidgetSize(id, workspace);
  const width = clamp(
    position.width * workspace.width,
    Math.min(minimum.width, workspace.width),
    workspace.width
  );
  const height = clamp(
    position.height * workspace.height,
    Math.min(minimum.height, workspace.height),
    workspace.height
  );
  const availableX = Math.max(0, workspace.width - width);
  const availableY = Math.max(0, workspace.height - height);
  return recoverOverlayWidgetControls(
    {
      left: position.x * availableX,
      top: position.y * availableY,
      width,
      height,
    },
    workspace,
    blockedRects
  );
};

/**
 * Resolves the shipped layout as three visual columns with a real pixel gap.
 * Normalized anchors remain resolution-independent, while a compact card that
 * reaches its intrinsic content height can no longer bleed into the next card.
 */
export const getOverlayDefaultWidgetBounds = (
  workspace: WidgetSize,
  blockedRects: ReadonlyArray<OverlayBlockedRect> = []
): Record<OverlayWidgetId, OverlayWidgetPixelBounds> => {
  const bounds = OVERLAY_WIDGET_IDS.reduce(
    (next, id) => {
      next[id] = getOverlayWidgetPixelBounds(
        id,
        DEFAULT_LAYOUT[id],
        workspace,
        blockedRects
      );
      return next;
    },
    {} as Record<OverlayWidgetId, OverlayWidgetPixelBounds>
  );

  for (const column of DEFAULT_LAYOUT_COLUMNS) {
    for (let index = 1; index < column.length; index += 1) {
      const previous = bounds[column[index - 1]];
      const current = bounds[column[index]];
      const minimumTop = previous.top + previous.height + DEFAULT_WIDGET_GAP;
      if (current.top >= minimumTop) continue;
      current.top = Math.min(
        minimumTop,
        Math.max(0, workspace.height - current.height)
      );
    }
  }

  return bounds;
};

const usesDefaultGeometry = (
  position: OverlayWidgetPosition,
  fallback: OverlayWidgetPosition
) =>
  position.x === fallback.x &&
  position.y === fallback.y &&
  position.width === fallback.width &&
  position.height === fallback.height;

/**
 * Digital alternative to pointer drag/resize. Movement is measured in pixels
 * but persisted in the same resolution-independent fractions as pointer edits.
 */
export const adjustOverlayWidgetForController = (
  id: OverlayWidgetId,
  position: OverlayWidgetPosition,
  mode: OverlayWidgetControllerEditMode,
  direction: OverlayWidgetControllerDirection,
  workspace: WidgetSize,
  stepPixels = 24
): OverlayWidgetPosition => {
  const minimum = getMinimumWidgetSize(id, workspace);
  const width = clamp(
    position.width * workspace.width,
    Math.min(minimum.width, workspace.width),
    workspace.width
  );
  const height = clamp(
    position.height * workspace.height,
    Math.min(minimum.height, workspace.height),
    workspace.height
  );
  const availableX = Math.max(0, workspace.width - width);
  const availableY = Math.max(0, workspace.height - height);
  const left = clamp(position.x * availableX, 0, availableX);
  const top = clamp(position.y * availableY, 0, availableY);

  if (mode === "move") {
    const nextLeft = clamp(
      left +
        (direction === "left"
          ? -stepPixels
          : direction === "right"
            ? stepPixels
            : 0),
      0,
      availableX
    );
    const nextTop = clamp(
      top +
        (direction === "up"
          ? -stepPixels
          : direction === "down"
            ? stepPixels
            : 0),
      0,
      availableY
    );
    return {
      ...position,
      x: availableX > 0 ? nextLeft / availableX : 0,
      y: availableY > 0 ? nextTop / availableY : 0,
    };
  }

  const minimumWidth = Math.min(minimum.width, workspace.width);
  const minimumHeight = Math.min(minimum.height, workspace.height);
  const nextWidth = clamp(
    width +
      (direction === "left"
        ? -stepPixels
        : direction === "right"
          ? stepPixels
          : 0),
    minimumWidth,
    Math.max(minimumWidth, workspace.width - left)
  );
  const nextHeight = clamp(
    height +
      (direction === "up"
        ? -stepPixels
        : direction === "down"
          ? stepPixels
          : 0),
    minimumHeight,
    Math.max(minimumHeight, workspace.height - top)
  );
  const nextAvailableX = Math.max(0, workspace.width - nextWidth);
  const nextAvailableY = Math.max(0, workspace.height - nextHeight);

  return {
    ...position,
    // Preserve the visible top-left origin while the bottom/right edges move.
    x: nextAvailableX > 0 ? clamp(left / nextAvailableX) : 0,
    y: nextAvailableY > 0 ? clamp(top / nextAvailableY) : 0,
    width: nextWidth / Math.max(1, workspace.width),
    height: nextHeight / Math.max(1, workspace.height),
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
  const [blockedHeaderRects, setBlockedHeaderRects] = useState<
    OverlayBlockedRect[]
  >([]);

  const widgetNodes = useRef(new Map<OverlayWidgetId, HTMLElement>());
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

    const nextBlockedHeaderRects = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".overlay-header__game, .overlay-header__actions"
      )
    )
      .map((element) => element.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > workspaceRect.left &&
          rect.left < workspaceRect.right
      )
      .map((rect) => ({
        left: clamp(rect.left - workspaceRect.left, 0, workspaceRect.width),
        top: clamp(rect.top - workspaceRect.top, 0, workspaceRect.height),
        right: clamp(rect.right - workspaceRect.left, 0, workspaceRect.width),
        bottom: clamp(rect.bottom - workspaceRect.top, 0, workspaceRect.height),
      }));
    setBlockedHeaderRects((current) => {
      const changed =
        current.length !== nextBlockedHeaderRects.length ||
        current.some((rect, index) => {
          const next = nextBlockedHeaderRects[index];
          return (
            !next ||
            rect.left !== next.left ||
            rect.top !== next.top ||
            rect.right !== next.right ||
            rect.bottom !== next.bottom
          );
        });
      return changed ? nextBlockedHeaderRects : current;
    });
  }, [workspaceRef]);

  const registerWidget = useCallback(
    (id: OverlayWidgetId, node: HTMLElement | null) => {
      if (node) {
        widgetNodes.current.set(id, node);
      } else {
        widgetNodes.current.delete(id);
      }

      requestAnimationFrame(measure);
    },
    [measure]
  );

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);

    const workspace = workspaceRef.current;
    if (workspace) observer.observe(workspace);
    for (const headerDock of document.querySelectorAll<HTMLElement>(
      ".overlay-header__game, .overlay-header__actions"
    )) {
      observer.observe(headerDock);
    }
    measure();

    return () => {
      observer.disconnect();
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
        const recovered = recoverOverlayWidgetControls(
          { left: fixedLeft, top: fixedTop, width, height },
          { width: workspaceRect.width, height: workspaceRect.height },
          blockedHeaderRects
        );
        const availableX = Math.max(0, workspaceRect.width - recovered.width);
        const availableY = Math.max(0, workspaceRect.height - recovered.height);

        setLayout((current) => ({
          ...current,
          [currentResize.id]: {
            ...current[currentResize.id],
            x: availableX > 0 ? clamp(recovered.left / availableX) : 0,
            y: availableY > 0 ? clamp(recovered.top / availableY) : 0,
            width: recovered.width / Math.max(1, workspaceRect.width),
            height: recovered.height / Math.max(1, workspaceRect.height),
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
      const recovered = recoverOverlayWidgetControls(
        {
          left,
          top,
          width: widgetRect.width,
          height: widgetRect.height,
        },
        { width: workspaceRect.width, height: workspaceRect.height },
        blockedHeaderRects
      );

      setLayout((current) => ({
        ...current,
        [currentDrag.id]: {
          ...current[currentDrag.id],
          x: availableX > 0 ? recovered.left / availableX : 0,
          y: availableY > 0 ? recovered.top / availableY : 0,
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
  }, [blockedHeaderRects, workspaceRef]);

  const getWidgetStyle = useCallback(
    (id: OverlayWidgetId): CSSProperties => {
      const position = layout[id];
      const column = DEFAULT_LAYOUT_COLUMNS.find((candidate) =>
        candidate.includes(id)
      );
      const hasDefaultColumnGeometry =
        column?.every((widgetId) =>
          usesDefaultGeometry(layout[widgetId], DEFAULT_LAYOUT[widgetId])
        ) ?? false;
      const recovered = hasDefaultColumnGeometry
        ? getOverlayDefaultWidgetBounds(workspaceSize, blockedHeaderRects)[id]
        : getOverlayWidgetPixelBounds(
            id,
            position,
            workspaceSize,
            blockedHeaderRects
          );
      return {
        left: Math.round(recovered.left),
        top: Math.round(recovered.top),
        width: Math.round(recovered.width),
        height: Math.round(recovered.height),
        zIndex: position.z,
      };
    },
    [blockedHeaderRects, layout, workspaceSize]
  );

  const focusWidget = useCallback((id: OverlayWidgetId) => {
    setLayout((current) => {
      const ordered = OVERLAY_WIDGET_IDS.filter((widgetId) => widgetId !== id)
        .sort((left, right) => current[left].z - current[right].z)
        .concat(id);
      const alreadyNormalized = ordered.every(
        (widgetId, index) => current[widgetId].z === index + 1
      );
      if (alreadyNormalized) return current;
      return ordered.reduce((next, widgetId, index) => {
        next[widgetId] = { ...current[widgetId], z: index + 1 };
        return next;
      }, {} as OverlayLayout);
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
      focusWidget(id);
    },
    [focusWidget, layoutLocked, workspaceRef]
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

  const adjustWidgetByController = useCallback(
    (
      id: OverlayWidgetId,
      mode: OverlayWidgetControllerEditMode,
      direction: OverlayWidgetControllerDirection
    ) => {
      if (layoutLocked) return;
      setLayout((current) => {
        const adjusted = adjustOverlayWidgetForController(
          id,
          current[id],
          mode,
          direction,
          workspaceSize
        );
        const minimum = getMinimumWidgetSize(id, workspaceSize);
        const width = clamp(
          adjusted.width * workspaceSize.width,
          Math.min(minimum.width, workspaceSize.width),
          workspaceSize.width
        );
        const height = clamp(
          adjusted.height * workspaceSize.height,
          Math.min(minimum.height, workspaceSize.height),
          workspaceSize.height
        );
        const availableX = Math.max(0, workspaceSize.width - width);
        const availableY = Math.max(0, workspaceSize.height - height);
        const recovered = recoverOverlayWidgetControls(
          {
            left: adjusted.x * availableX,
            top: adjusted.y * availableY,
            width,
            height,
          },
          workspaceSize,
          blockedHeaderRects
        );
        const recoveredAvailableX = Math.max(
          0,
          workspaceSize.width - recovered.width
        );
        const recoveredAvailableY = Math.max(
          0,
          workspaceSize.height - recovered.height
        );
        return {
          ...current,
          [id]: {
            ...adjusted,
            x:
              recoveredAvailableX > 0
                ? recovered.left / recoveredAvailableX
                : 0,
            y:
              recoveredAvailableY > 0 ? recovered.top / recoveredAvailableY : 0,
            width: recovered.width / Math.max(1, workspaceSize.width),
            height: recovered.height / Math.max(1, workspaceSize.height),
          },
        };
      });
      focusWidget(id);
    },
    [blockedHeaderRects, focusWidget, layoutLocked, workspaceSize]
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
    adjustWidgetByController,
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
