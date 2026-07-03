import type { EmulatorSystem } from "@types";
import {
  PLATFORM_LOGOS,
  PLATFORM_LABELS,
} from "@renderer/assets/emulation/platform-logos";

// Supported consoles, in a pleasing display order.
const CONSOLES: EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n64",
  "gc",
  "wii",
  "wiiu",
  "n3ds",
  "nds",
  "dsi",
  "gba",
  "gb",
  "gbc",
];

/**
 * Hero for the classics onboarding: an array of every console logo GameHub
 * supports, so the first thing the user sees is exactly which systems they get.
 */
export function ConsoleLogosHero() {
  return (
    <div className="console-logos-hero">
      <div className="console-logos-hero__grid">
        {CONSOLES.map((system) => {
          const logo = PLATFORM_LOGOS[system];
          if (!logo) return null;
          return (
            <div key={system} className="console-logos-hero__cell">
              <img
                src={logo}
                alt={PLATFORM_LABELS[system]}
                className="console-logos-hero__logo"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
