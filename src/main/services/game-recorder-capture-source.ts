export type RecorderCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RecorderDisplayGeometry = {
  bounds: RecorderCaptureBounds;
  scaleFactor?: number;
};

const DISPLAY_COVERAGE_THRESHOLD = 0.98;
const DISPLAY_OVERSCAN_LIMIT = 1.04;

const approximatelyCovers = (
  windowBounds: RecorderCaptureBounds,
  displayBounds: RecorderCaptureBounds,
  scaleFactor: number
) => {
  const width = displayBounds.width * scaleFactor;
  const height = displayBounds.height * scaleFactor;
  if (width <= 0 || height <= 0) return false;
  const widthRatio = windowBounds.width / width;
  const heightRatio = windowBounds.height / height;
  const edgeTolerance = Math.max(8, Math.min(width, height) * 0.01);
  return (
    widthRatio >= DISPLAY_COVERAGE_THRESHOLD &&
    heightRatio >= DISPLAY_COVERAGE_THRESHOLD &&
    widthRatio <= DISPLAY_OVERSCAN_LIMIT &&
    heightRatio <= DISPLAY_OVERSCAN_LIMIT &&
    Math.abs(windowBounds.x - displayBounds.x * scaleFactor) <= edgeTolerance &&
    Math.abs(windowBounds.y - displayBounds.y * scaleFactor) <= edgeTolerance
  );
};

/**
 * Decide whether a game is effectively fullscreen on its matched display.
 * Native HWND bounds are physical pixels on some DPI configurations while
 * Electron display bounds are DIP, so compare both logical and scaled sizes.
 */
export const isGameWindowDisplaySized = (
  windowBounds: RecorderCaptureBounds | null,
  display: RecorderDisplayGeometry | null
) => {
  if (!windowBounds || !display) return false;
  if (
    windowBounds.width <= 0 ||
    windowBounds.height <= 0 ||
    display.bounds.width <= 0 ||
    display.bounds.height <= 0
  ) {
    return false;
  }

  if (approximatelyCovers(windowBounds, display.bounds, 1)) {
    return true;
  }

  const scaleFactor = display.scaleFactor ?? 1;
  return (
    scaleFactor > 1 &&
    approximatelyCovers(windowBounds, display.bounds, scaleFactor)
  );
};
