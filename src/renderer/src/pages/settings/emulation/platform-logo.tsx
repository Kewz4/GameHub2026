import { useState } from "react";
import type { EmulatorSystem } from "@types";
import {
  PLATFORM_LOGOS,
  PLATFORM_LABELS,
} from "@renderer/assets/emulation/platform-logos";

/**
 * White platform logo, with a short text-label fallback for systems that have
 * no logo art (PSP) or if the SVG fails to load.
 */
export function PlatformLogo({
  system,
  className,
}: Readonly<{ system: EmulatorSystem; className?: string }>) {
  const [failed, setFailed] = useState(false);
  const logo = PLATFORM_LOGOS[system];
  const label = PLATFORM_LABELS[system];

  if (!logo || failed) {
    return <span className={className}>{label}</span>;
  }
  return (
    <img
      src={logo}
      alt={label}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
