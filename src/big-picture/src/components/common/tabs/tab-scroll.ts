interface TabRevealMeasurements {
  currentScrollLeft: number;
  viewportWidth: number;
  scrollWidth: number;
  itemOffsetLeft: number;
  itemWidth: number;
  padding?: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getTabRevealScrollLeft({
  currentScrollLeft,
  viewportWidth,
  scrollWidth,
  itemOffsetLeft,
  itemWidth,
  padding = 24,
}: TabRevealMeasurements) {
  const maximumScrollLeft = Math.max(0, scrollWidth - viewportWidth);
  const safePadding = Math.min(
    Math.max(0, padding),
    Math.max(0, viewportWidth / 2 - 1)
  );
  const itemRight = itemOffsetLeft + itemWidth;
  const visibleLeft = currentScrollLeft + safePadding;
  const visibleRight = currentScrollLeft + viewportWidth - safePadding;

  if (itemOffsetLeft < visibleLeft) {
    return clamp(itemOffsetLeft - safePadding, 0, maximumScrollLeft);
  }

  if (itemRight > visibleRight) {
    return clamp(itemRight - viewportWidth + safePadding, 0, maximumScrollLeft);
  }

  return clamp(currentScrollLeft, 0, maximumScrollLeft);
}
