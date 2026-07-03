import type { EmulatorSystem } from "@types";
import { systemForGame } from "@renderer/pages/library/console-filter";
import type { Game } from "@types";
import "./platform-badge.scss";

/** Short console name + a brand accent for the game-details banner badge. */
const PLATFORM_BADGE: Record<EmulatorSystem, { label: string; color: string }> =
  {
    ps1: { label: "PlayStation", color: "#2e6db4" },
    ps2: { label: "PlayStation 2", color: "#2e6db4" },
    ps3: { label: "PlayStation 3", color: "#2e6db4" },
    psp: { label: "PSP", color: "#2e6db4" },
    n3ds: { label: "Nintendo 3DS", color: "#c8102e" },
    nds: { label: "Nintendo DS", color: "#c8102e" },
    dsi: { label: "Nintendo DSi", color: "#c8102e" },
    n64: { label: "Nintendo 64", color: "#0aad4b" },
    gb: { label: "Game Boy", color: "#7b57a6" },
    gbc: { label: "Game Boy Color", color: "#7b57a6" },
    gba: { label: "Game Boy Advance", color: "#5a3aa6" },
    wii: { label: "Wii", color: "#1aa3d6" },
    wiiu: { label: "Wii U", color: "#1aa3d6" },
    gc: { label: "GameCube", color: "#4a3a8a" },
  };

/**
 * Resolve the console for a game from its objectId ("minerva:<system>:…") or
 * its stored platform. Returns null for non-console (PC) games.
 */
function resolveSystem(
  objectId: string | null | undefined,
  game: Game | null | undefined
): EmulatorSystem | null {
  if (objectId?.startsWith("minerva:")) {
    const seg = objectId.split(":")[1] as EmulatorSystem;
    if (seg in PLATFORM_BADGE) return seg;
  }
  if (game) {
    const s = systemForGame(game);
    if (s && s in PLATFORM_BADGE) return s;
  }
  return null;
}

/**
 * Platform badge shown top-right of the game-details banner for console games,
 * so e.g. Skyward Sword is clearly tagged "Wii" (and the GameCube vs Wii
 * versions of a cross-platform title are distinguishable). Renders nothing for
 * PC games.
 */
export function PlatformBadge({
  objectId,
  game,
}: Readonly<{
  objectId: string | null | undefined;
  game: Game | null | undefined;
}>) {
  const system = resolveSystem(objectId, game);
  if (!system) return null;
  const { label, color } = PLATFORM_BADGE[system];

  return (
    <span
      className="game-details__platform-badge"
      style={{ ["--platform-accent" as string]: color }}
      title={label}
    >
      {label}
    </span>
  );
}
