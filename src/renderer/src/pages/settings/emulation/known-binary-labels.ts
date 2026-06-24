import type { EmulatorBinary } from "@types";

export const KNOWN_BINARY_LABELS: Record<EmulatorBinary, string> = {
  duckstation: "DuckStation",
  pcsx2: "PCSX2",
  rpcs3: "RPCS3",
  ppsspp: "PPSSPP",
  azahar: "Azahar",
  ralibretro: "RALibretro",
  raproject64: "RAProject64",
  ravba: "RAVBA",
  cemu: "Cemu",
  dolphin: "Dolphin",
};
