export function getVisibleCataloguePageRange(page: number, totalPages: number) {
  const count = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  const current = Number.isFinite(page)
    ? Math.max(1, Math.min(count, Math.floor(page)))
    : 1;
  const start = Math.max(1, Math.min(current - 1, count - 2));
  const end = Math.min(count, start + 2);
  return {
    start,
    end,
    isLastThree: count > 3 && current >= count - 2,
    showTrailingJump: end < count,
  };
}
