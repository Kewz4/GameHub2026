export const MIN_BIG_PICTURE_HEADER_FOOTPRINT = 56;

export function resolveBigPictureHeaderFootprint(
  measuredHeight: number,
  minimumHeight = MIN_BIG_PICTURE_HEADER_FOOTPRINT
) {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
    return minimumHeight;
  }

  return Math.max(minimumHeight, Math.ceil(measuredHeight));
}
