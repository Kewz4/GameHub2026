import type { GameShop } from "@types";

export type GameOrigin = "sync" | "catalog" | "custom";

const PLATFORM_SCHEMES = [
  "steam://",
  "legendary://",
  "goggalaxy://",
  "msxbox://",
  "battlenet://",
];

interface OriginSource {
  shop: GameShop;
  libraryOrigin?: GameOrigin;
  executablePath?: string | null;
}

/**
 * Classify how a game entered the library.
 * - "sync": owned on a connected platform (Steam/Epic/GOG/Xbox/Battle.net)
 * - "custom": added manually via "Add custom game"
 * - "catalog": added from the Hydra API catalog (not owned anywhere)
 *
 * Every platform sync function stamps libraryOrigin: "sync" during its
 * migration pass, so genuinely synced games always have the field set.
 * Legacy records without libraryOrigin that also lack a platform URI scheme
 * in their exe path are treated as catalog games — defaulting to "sync" was
 * overly permissive and caused catalogue games to leak into platform filters.
 */
export function getGameOrigin(game: OriginSource): GameOrigin {
  if (game.libraryOrigin) return game.libraryOrigin;
  if (game.shop === "custom") return "custom";
  const exe = game.executablePath;
  if (exe && PLATFORM_SCHEMES.some((scheme) => exe.startsWith(scheme))) {
    return "sync";
  }
  // No libraryOrigin stamp and no platform URI → treat as catalog.
  // Sync functions migrate existing entries on every run, so a legitimately
  // owned game will have been stamped "sync" the first time the user synced
  // their platform library.
  return "catalog";
}
