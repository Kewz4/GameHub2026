import type { EmulatorSystem } from "@types";

export type StepKind =
  | "find_emulator"
  | "firmware"
  | "bios"
  | "rom_folder"
  | "scanning"
  | "done";

export interface PendingFolder {
  path: string;
  scanSubfolders: boolean;
  previewCount: number | null;
}

export const stepListForSystem = (system: EmulatorSystem): StepKind[] => {
  // Only PlayStation needs a user-supplied system file: PS3 a firmware dump,
  // PS1/PS2 a BIOS. Every other emulator (RA cores, Cemu, Dolphin, Azahar,
  // PPSSPP, …) runs games without one, so they skip straight to the ROM folder
  // instead of being shown a bogus "Copy your PS2 BIOS" step.
  if (system === "ps3") {
    return ["find_emulator", "firmware", "rom_folder", "scanning", "done"];
  }
  if (system === "ps1" || system === "ps2") {
    return ["find_emulator", "bios", "rom_folder", "scanning", "done"];
  }
  return ["find_emulator", "rom_folder", "scanning", "done"];
};
