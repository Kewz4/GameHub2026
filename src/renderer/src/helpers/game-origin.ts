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
 * Records created before the libraryOrigin field existed fall back to a
 * heuristic: custom shop → custom, platform URL scheme exe → sync,
 * otherwise catalog.
 */
export function getGameOrigin(game: OriginSource): GameOrigin {
  if (game.libraryOrigin) return game.libraryOrigin;
  if (game.shop === "custom") return "custom";
  const exe = game.executablePath;
  if (exe && PLATFORM_SCHEMES.some((scheme) => exe.startsWith(scheme))) {
    return "sync";
  }
  // Legacy records without libraryOrigin: GOG/Xbox/BattleNet don't set
  // scheme-based paths, and installed Epic games use real file paths.
  // Default to "sync" — catalog is only reliable for records created after
  // v2.5 where libraryOrigin is explicitly stamped.
  return "sync";
}
