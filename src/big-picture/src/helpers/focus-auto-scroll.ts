import type { FocusAutoScrollMode, FocusNode, FocusRegion } from "../services";

const SAFE_SCROLL_MARGIN = 96;
const ROW_TOLERANCE_PX = 24;
const SCROLL_ANIMATION_DURATION = 180;

const scrollAnimationFrames = new WeakMap<Element, number>();

type ScrollBehaviorMode = "keep-visible" | "prefer-center";

interface RowItem {
  id: string;
  rect: DOMRect;
}

interface ResolvedScrollTarget {
  container: HTMLElement;
  rect: DOMRect;
  key: string;
}

function shouldSuppressNavigationAutoScroll(element: HTMLElement) {
  return (
    element.closest("[data-suppress-navigation-autoscroll='true']") !== null
  );
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isScrollableElement(element: HTMLElement): boolean {
  const style = globalThis.getComputedStyle(element);
  const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
  const canScroll = /(auto|scroll|overlay)/.test(overflow);

  return (
    canScroll &&
    (element.scrollHeight > element.clientHeight ||
      element.scrollWidth > element.clientWidth)
  );
}

function getScrollContainer(element: HTMLElement): HTMLElement {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (isScrollableElement(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function getContainerRect(container: HTMLElement): DOMRect {
  if (container === document.scrollingElement) {
    return new DOMRect(0, 0, globalThis.innerWidth, globalThis.innerHeight);
  }

  return container.getBoundingClientRect();
}

interface NavigationScrollPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export function resolveNavigationScrollInsets(
  containerSize: { width: number; height: number },
  scrollPadding: NavigationScrollPadding = {}
) {
  const horizontalMargin = Math.min(
    SAFE_SCROLL_MARGIN,
    Math.max(0, containerSize.width / 2 - 1)
  );
  const verticalMargin = Math.min(
    SAFE_SCROLL_MARGIN,
    Math.max(0, containerSize.height / 2 - 1)
  );

  return {
    top: Math.max(verticalMargin, scrollPadding.top ?? 0),
    right: Math.max(horizontalMargin, scrollPadding.right ?? 0),
    bottom: Math.max(verticalMargin, scrollPadding.bottom ?? 0),
    left: Math.max(horizontalMargin, scrollPadding.left ?? 0),
  };
}

function parsePixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSafeInsets(containerRect: DOMRect, container: HTMLElement) {
  const style = globalThis.getComputedStyle(container);

  return resolveNavigationScrollInsets(
    { width: containerRect.width, height: containerRect.height },
    {
      top: parsePixelValue(style.scrollPaddingTop),
      right: parsePixelValue(style.scrollPaddingRight),
      bottom: parsePixelValue(style.scrollPaddingBottom),
      left: parsePixelValue(style.scrollPaddingLeft),
    }
  );
}

function canScrollAxis(container: HTMLElement, axis: "x" | "y") {
  if (container === document.scrollingElement) return true;

  const style = globalThis.getComputedStyle(container);
  const overflow = axis === "x" ? style.overflowX : style.overflowY;

  return /(auto|scroll|overlay)/.test(overflow);
}

export function resolveNavigationScrollAxisTarget(options: {
  current: number;
  delta: number;
  maximum: number;
  enabled: boolean;
}) {
  if (!options.enabled) return 0;

  return clamp(options.current + options.delta, 0, options.maximum);
}

function getRectCenter(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function toRowRect(items: RowItem[]): DOMRect {
  const top = Math.min(...items.map((item) => item.rect.top));
  const right = Math.max(...items.map((item) => item.rect.right));
  const bottom = Math.max(...items.map((item) => item.rect.bottom));
  const left = Math.min(...items.map((item) => item.rect.left));

  return new DOMRect(left, top, right - left, bottom - top);
}

function groupItemsIntoRows(items: RowItem[]) {
  const sortedItems = [...items].sort((leftItem, rightItem) => {
    if (Math.abs(leftItem.rect.top - rightItem.rect.top) > ROW_TOLERANCE_PX) {
      return leftItem.rect.top - rightItem.rect.top;
    }

    return leftItem.rect.left - rightItem.rect.left;
  });

  return sortedItems.reduce<RowItem[][]>((rows, item) => {
    const lastRow = rows.at(-1);

    if (!lastRow) {
      rows.push([item]);
      return rows;
    }

    if (Math.abs(lastRow[0].rect.top - item.rect.top) > ROW_TOLERANCE_PX) {
      rows.push([item]);
      return rows;
    }

    lastRow.push(item);
    lastRow.sort(
      (leftItem, rightItem) => leftItem.rect.left - rightItem.rect.left
    );
    return rows;
  }, []);
}

function cancelScrollAnimation(container: HTMLElement): void {
  const animationFrame = scrollAnimationFrames.get(container);

  if (animationFrame === undefined) return;

  globalThis.cancelAnimationFrame(animationFrame);
  scrollAnimationFrames.delete(container);
}

export function cancelNavigationAutoScrollForElement(
  element: HTMLElement | null
): void {
  if (!element) return;

  const container = isScrollableElement(element)
    ? element
    : getScrollContainer(element);

  cancelScrollAnimation(container);
}

export function animateNavigationScrollForElement(
  element: HTMLElement | null,
  target: { left?: number; top: number }
): void {
  if (!element) return;

  const container = isScrollableElement(element)
    ? element
    : getScrollContainer(element);

  animateScroll(container, {
    left: target.left ?? container.scrollLeft,
    top: target.top,
  });
}

function animateScroll(
  container: HTMLElement,
  target: { left: number; top: number }
): void {
  cancelScrollAnimation(container);

  const startLeft = container.scrollLeft;
  const startTop = container.scrollTop;
  const distanceLeft = target.left - startLeft;
  const distanceTop = target.top - startTop;

  if (distanceLeft === 0 && distanceTop === 0) return;

  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = clamp(elapsed / SCROLL_ANIMATION_DURATION, 0, 1);
    const easedProgress = easeOutCubic(progress);

    container.scrollLeft = startLeft + distanceLeft * easedProgress;
    container.scrollTop = startTop + distanceTop * easedProgress;

    if (progress < 1) {
      scrollAnimationFrames.set(
        container,
        globalThis.requestAnimationFrame(step)
      );
      return;
    }

    container.scrollLeft = target.left;
    container.scrollTop = target.top;
    scrollAnimationFrames.delete(container);
  };

  scrollAnimationFrames.set(container, globalThis.requestAnimationFrame(step));
}

function getKeepVisibleTarget(rect: DOMRect, container: HTMLElement) {
  const containerRect = getContainerRect(container);
  const safeInsets = getSafeInsets(containerRect, container);

  const safeTop = containerRect.top + safeInsets.top;
  const safeBottom = containerRect.bottom - safeInsets.bottom;
  const safeLeft = containerRect.left + safeInsets.left;
  const safeRight = containerRect.right - safeInsets.right;

  let deltaY = 0;
  let deltaX = 0;

  if (rect.top < safeTop) {
    deltaY = rect.top - safeTop;
  } else if (rect.bottom > safeBottom) {
    deltaY = rect.bottom - safeBottom;
  }

  if (rect.left < safeLeft) {
    deltaX = rect.left - safeLeft;
  } else if (rect.right > safeRight) {
    deltaX = rect.right - safeRight;
  }

  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);

  return {
    left: resolveNavigationScrollAxisTarget({
      current: container.scrollLeft,
      delta: deltaX,
      maximum: maxLeft,
      enabled: canScrollAxis(container, "x"),
    }),
    top: resolveNavigationScrollAxisTarget({
      current: container.scrollTop,
      delta: deltaY,
      maximum: maxTop,
      enabled: canScrollAxis(container, "y"),
    }),
  };
}

function getPreferCenterTarget(rect: DOMRect, container: HTMLElement) {
  const containerRect = getContainerRect(container);
  const safeInsets = getSafeInsets(containerRect, container);
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);

  const currentRectHeight = rect.height;
  const availableHeight = Math.max(
    0,
    containerRect.height - safeInsets.top - safeInsets.bottom
  );
  const currentCenter = getRectCenter(rect);
  const safeCenterY =
    containerRect.top + safeInsets.top + Math.max(0, availableHeight) / 2;

  const top =
    currentRectHeight >= availableHeight
      ? container.scrollTop + (rect.top - containerRect.top) - safeInsets.top
      : container.scrollTop + (currentCenter.y - safeCenterY);

  const horizontalTarget = getKeepVisibleTarget(rect, container);

  return {
    left: clamp(horizontalTarget.left, 0, maxLeft),
    top: canScrollAxis(container, "y") ? clamp(top, 0, maxTop) : 0,
  };
}

function getRegionMap(regions: FocusRegion[]) {
  return new Map(regions.map((region) => [region.id, region]));
}

function resolveRegionAutoScrollMode(
  region: FocusRegion,
  parentRegion: FocusRegion | null
): FocusAutoScrollMode {
  if (region.autoScrollMode && region.autoScrollMode !== "auto") {
    return region.autoScrollMode;
  }

  if (region.orientation === "grid") {
    return "row";
  }

  if (
    region.orientation === "horizontal" &&
    parentRegion?.orientation === "vertical"
  ) {
    return "region";
  }

  return "item";
}

function resolveRegionAnchor(region: FocusRegion): HTMLElement | null {
  const explicitAnchor = region.getScrollAnchor?.() ?? null;

  if (explicitAnchor) return explicitAnchor;

  return region.getElement?.() ?? null;
}

function resolveRowTarget(
  node: FocusNode,
  region: FocusRegion,
  nodes: FocusNode[]
): ResolvedScrollTarget | null {
  const currentElement = node.getElement?.() ?? null;

  if (!currentElement) return null;

  const container = getScrollContainer(currentElement);
  const rowItems = nodes
    .filter(
      (candidate) =>
        candidate.regionId === region.id &&
        candidate.navigationState === "active"
    )
    .map((candidate) => {
      const element = candidate.getElement?.() ?? null;
      const rect = element?.getBoundingClientRect() ?? null;

      if (!element || !rect) return null;

      return {
        id: candidate.id,
        rect,
      };
    })
    .filter((item): item is RowItem => item !== null);

  if (rowItems.length === 0) return null;

  const rows = groupItemsIntoRows(rowItems);
  const currentRowIndex = rows.findIndex((row) =>
    row.some((item) => item.id === node.id)
  );

  if (currentRowIndex === -1) return null;

  return {
    container,
    rect: toRowRect(rows[currentRowIndex]),
    key: `row:${region.id}:${currentRowIndex}`,
  };
}

function resolveScrollTarget(options: {
  node: FocusNode;
  nodes: FocusNode[];
  regions: FocusRegion[];
}): ResolvedScrollTarget | null {
  const regionMap = getRegionMap(options.regions);
  const currentRegion = regionMap.get(options.node.regionId) ?? null;

  if (!currentRegion) return null;

  const parentRegion = currentRegion.parentRegionId
    ? (regionMap.get(currentRegion.parentRegionId) ?? null)
    : null;

  const autoScrollMode = resolveRegionAutoScrollMode(
    currentRegion,
    parentRegion
  );

  if (autoScrollMode === "row") {
    const rowTarget = resolveRowTarget(
      options.node,
      currentRegion,
      options.nodes
    );

    if (rowTarget) return rowTarget;
  }

  if (autoScrollMode === "region") {
    const anchor = resolveRegionAnchor(currentRegion);

    if (anchor) {
      return {
        container: getScrollContainer(anchor),
        rect: anchor.getBoundingClientRect(),
        key: `region:${currentRegion.id}`,
      };
    }
  }

  const element = options.node.getElement?.() ?? null;

  if (!element) return null;

  return {
    container: getScrollContainer(element),
    rect: element.getBoundingClientRect(),
    key: `item:${options.node.id}`,
  };
}

function getScrollBehaviorMode(
  currentTarget: ResolvedScrollTarget,
  previousTarget: ResolvedScrollTarget | null
): ScrollBehaviorMode {
  if (!previousTarget) return "prefer-center";
  if (currentTarget.container !== previousTarget.container)
    return "prefer-center";
  if (currentTarget.key !== previousTarget.key) return "prefer-center";
  return "keep-visible";
}

export function scrollNavigationIntoView(options: {
  currentFocusId: string | null;
  previousFocusId?: string | null;
  nodes: FocusNode[];
  regions: FocusRegion[];
}): void {
  if (!options.currentFocusId) return;

  const nodesById = new Map(options.nodes.map((node) => [node.id, node]));
  const currentNode = nodesById.get(options.currentFocusId) ?? null;

  if (!currentNode) return;

  const currentElement = currentNode.getElement?.() ?? null;

  if (!currentElement) return;
  if (shouldSuppressNavigationAutoScroll(currentElement)) return;

  const currentTarget = resolveScrollTarget({
    node: currentNode,
    nodes: options.nodes,
    regions: options.regions,
  });

  if (!currentTarget) return;

  const previousNode = options.previousFocusId
    ? (nodesById.get(options.previousFocusId) ?? null)
    : null;
  const previousTarget = previousNode
    ? resolveScrollTarget({
        node: previousNode,
        nodes: options.nodes,
        regions: options.regions,
      })
    : null;

  const behaviorMode = getScrollBehaviorMode(currentTarget, previousTarget);
  const target =
    behaviorMode === "prefer-center"
      ? getPreferCenterTarget(currentTarget.rect, currentTarget.container)
      : getKeepVisibleTarget(currentTarget.rect, currentTarget.container);

  animateScroll(currentTarget.container, target);
}
