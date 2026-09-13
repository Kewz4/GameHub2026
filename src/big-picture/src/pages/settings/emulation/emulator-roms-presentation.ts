import type { DetectedRom } from "@types";

export const BIG_PICTURE_EMULATOR_ROMS_PAGE_SIZE = 8;

export function getBigPictureEmulatorRomsPage(
  roms: readonly DetectedRom[],
  query: string,
  requestedPage: number
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = normalizedQuery
    ? roms.filter(
        (rom) =>
          rom.title.toLocaleLowerCase().includes(normalizedQuery) ||
          rom.skus.some((sku) =>
            sku.toLocaleLowerCase().includes(normalizedQuery)
          )
      )
    : [...roms];
  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / BIG_PICTURE_EMULATOR_ROMS_PAGE_SIZE)
  );
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const start = page * BIG_PICTURE_EMULATOR_ROMS_PAGE_SIZE;

  return {
    filtered,
    page,
    pageCount,
    items: filtered.slice(start, start + BIG_PICTURE_EMULATOR_ROMS_PAGE_SIZE),
  };
}
