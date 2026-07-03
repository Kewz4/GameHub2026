import type { EmulatorSystem } from "@types";

// White platform wordmark/logo SVGs (user-provided).
import ps1 from "./platforms/ps1.svg?url";
import psp from "./platforms/psp.svg?url";
import ps2 from "./platforms/ps2.svg?url";
import ps3 from "./platforms/ps3.svg?url";
import n3ds from "./platforms/n3ds.svg?url";
import nds from "./platforms/nds.svg?url";
import dsi from "./platforms/dsi.svg?url";
import n64 from "./platforms/n64.svg?url";
import gb from "./platforms/gb.svg?url";
import gbc from "./platforms/gbc.svg?url";
import gba from "./platforms/gba.svg?url";
import wiiu from "./platforms/wiiu.svg?url";
import wii from "./platforms/wii.svg?url";
import gc from "./platforms/gc.svg?url";

/** White logo per console. */
export const PLATFORM_LOGOS: Partial<Record<EmulatorSystem, string>> = {
  ps1,
  psp,
  ps2,
  ps3,
  n3ds,
  nds,
  dsi,
  n64,
  gb,
  gbc,
  gba,
  wiiu,
  wii,
  gc,
};

/** Human-readable console name, used as the logo alt / text fallback. */
export const PLATFORM_LABELS: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PSP",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Wii U",
  wii: "Wii",
  gc: "GameCube",
};
