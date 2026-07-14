import type { EmulatorBinary, EmulatorSystem } from "@types";

import pcsx2Logo from "@renderer/assets/emulation/logos/pcsx2.svg?url";
import rpcs3Logo from "@renderer/assets/emulation/logos/rpcs3.svg?url";
import azaharLogo from "@renderer/assets/emulation/logos/azahar.svg?url";
import cemuLogo from "@renderer/assets/emulation/logos/cemu.png";
import dolphinLogo from "@renderer/assets/emulation/logos/dolphin.png";
import edenLogo from "@renderer/assets/emulation/logos/eden.png";
import raLogo from "@renderer/assets/emulation/logos/retroachievements.svg?url";

export interface EmulatorEntry {
  binary: EmulatorBinary;
  name: string;
  /** Every system this one install serves, in display order. */
  systems: EmulatorSystem[];
  hasRetroAchievements: boolean;
  logo: string;
  /** Whether the logo is a full-colour icon (skip the white-force filter). */
  colorLogo?: boolean;
}

/**
 * The emulators GameHub manages, one entry per install. RALibretro is a single
 * install that serves eight consoles (its bundled libretro cores), so it gets
 * ONE card here instead of eight per-platform cards.
 */
export const EMULATORS: EmulatorEntry[] = [
  {
    binary: "ralibretro",
    name: "RALibretro",
    systems: ["ps1", "n64", "psp", "nds", "dsi", "gba", "gb", "gbc"],
    hasRetroAchievements: true,
    logo: raLogo,
  },
  {
    binary: "pcsx2",
    name: "PCSX2",
    systems: ["ps2"],
    hasRetroAchievements: true,
    logo: pcsx2Logo,
  },
  {
    binary: "rpcs3",
    name: "RPCS3",
    systems: ["ps3"],
    hasRetroAchievements: false,
    logo: rpcs3Logo,
    colorLogo: true,
  },
  {
    binary: "azahar",
    name: "Azahar",
    systems: ["n3ds"],
    hasRetroAchievements: false,
    logo: azaharLogo,
    colorLogo: true,
  },
  {
    binary: "cemu",
    name: "Cemu",
    systems: ["wiiu"],
    hasRetroAchievements: false,
    logo: cemuLogo,
    colorLogo: true,
  },
  {
    binary: "dolphin",
    name: "Dolphin",
    systems: ["wii", "gc"],
    hasRetroAchievements: true,
    logo: dolphinLogo,
  },
  {
    binary: "eden",
    name: "Eden",
    systems: ["switch"],
    hasRetroAchievements: false,
    logo: edenLogo,
    colorLogo: true,
  },
];
