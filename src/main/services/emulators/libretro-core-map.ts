/** Both frontends must load the same libretro implementation before raw
 * SAVE_RAM can be rebound to a different frontend filename without conversion. */
export const LIBRETRO_CORE_MAP = {
  ps1: { core: "mednafen_psx_libretro", systemId: 12, rawSram: false },
  psp: { core: "ppsspp_libretro", systemId: 41, rawSram: false },
  gba: { core: "mgba_libretro", systemId: 5, rawSram: true },
  gb: { core: "mgba_libretro", systemId: 4, rawSram: true },
  gbc: { core: "mgba_libretro", systemId: 6, rawSram: true },
  n64: { core: "mupen64plus_next_libretro", systemId: 2, rawSram: true },
  nds: { core: "melondsds_libretro", systemId: 18, rawSram: true },
  dsi: { core: "melondsds_libretro", systemId: 78, rawSram: true },
} as const;
