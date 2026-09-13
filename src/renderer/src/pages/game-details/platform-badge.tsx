import { useState } from "react";
import type { EmulatorSystem, Game } from "@types";
import {
  systemForGame,
  resolveEffectiveSystem,
} from "@renderer/pages/library/console-filter";
import {
  PLATFORM_LOGOS,
  PLATFORM_LABELS,
} from "@renderer/assets/emulation/platform-logos";
import "./platform-badge.scss";

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
    if (seg in PLATFORM_LABELS) {
      // The merged gb_gba_gbc catalogue bakes "gba" into every Game Boy
      // objectId; if a ROM is bound, its extension is the real console.
      const effective = resolveEffectiveSystem(
        seg,
        game?.selectedDiscPath ?? game?.discs?.[0]?.path
      );
      if (effective && effective in PLATFORM_LABELS) return effective;
    }
  }
  if (game) {
    const s = systemForGame(game);
    if (s && s in PLATFORM_LABELS) return s;
  }
  return null;
}

/**
 * Platform logo shown top-right of the game-details banner for console games,
 * so e.g. Skyward Sword shows the Wii logo (and the GameCube vs Wii versions
 * of a cross-platform title are distinguishable). Falls back to a text label
 * when no logo art exists (PSP) or the SVG fails to load. Renders nothing for
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
  const [failed, setFailed] = useState(false);
  if (!system) return null;

  const label = PLATFORM_LABELS[system];
  const logo = PLATFORM_LOGOS[system];

  if (logo && !failed) {
    return (
      <span className="game-details__platform-badge" title={label}>
        <img
          src={logo}
          alt={label}
          className="game-details__platform-badge-logo"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className="game-details__platform-badge game-details__platform-badge--text"
      title={label}
    >
      {label}
    </span>
  );
}
