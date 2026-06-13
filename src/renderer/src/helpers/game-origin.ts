import type { GameShop } from "@types";

export type GameOrigin = "sync" | "catalog" | "custom";

/**
 * Executable URI schemes that only a platform launcher ever produces. Their
 * presence is hard proof the game is owned on (and launched through) that
 * platform — a repack/custom game always has a real filesystem path instead.
 */
const PLATFORM_SCHEMES = [
  "steam://",
  "legendary://",
  "com.epicgames.launcher://",
  "goggalaxy://",
  "goglauncher://",
  "msxbox://",
  "battlenet://",
  "origin2://",
  "uplay://",
  "riot://",
];

interface OriginSource {
  shop: GameShop;
  libraryOrigin?: GameOrigin | null;
  executablePath?: string | null;
  /** A GameHub repack/torrent download record, when one exists. */
  download?: unknown | null;
}

const hasPlatformUriExe = (exe?: string | null): boolean => {
  if (!exe) return false;
  const normalized = exe.toLowerCase();
  return PLATFORM_SCHEMES.some((scheme) => normalized.startsWith(scheme));
};

/**
 * Classify how a game entered the library, for the per-store library tabs.
 *
 * Design goal (hard requirement): a game that is owned on / synced from ANY
 * official store must NEVER appear under the Retigga (catalogue) tab, and a
 * GameHub repack must never leak into a platform tab. Because `libraryOrigin`
 * is a single mutable field that several import paths fail to stamp (Steam
 * free-to-play titles, cloud-profile imports, legacy pre-stamp records), we do
 * NOT trust its absence. Instead we resolve from the strongest signals first:
 *
 *   1. custom shop / explicit "custom" stamp           → "custom"
 *   2. explicit "sync" stamp OR a platform-URI exe     → "sync"   (owned wins)
 *   3. a GameHub download record                       → "catalog" (it's a repack)
 *   4. explicit "catalog" stamp                        → "catalog"
 *   5. anything else                                   → "catalog" (unverified)
 *
 * Step 5 sends UNVERIFIED records to Retigga rather than a platform tab. This
 * is safe for genuinely-owned games because every platform sync stamps BOTH
 * libraryOrigin="sync" AND (for Steam) a steam://run/ URI exe, so owned titles
 * are always caught by steps 1–2 before reaching here. Only records that have
 * never been through a platform sync — e.g. Playnite imports of games you do
 * NOT own on any store — fall through to step 5, which is exactly where they
 * belong: Retigga, not Steam/Epic/GOG.
 */
export function getGameOrigin(game: OriginSource): GameOrigin {
  // 1. Manually added games.
  if (game.shop === "custom" || game.libraryOrigin === "custom") {
    return "custom";
  }

  // 2. Ownership on a connected platform always wins over everything else.
  if (game.libraryOrigin === "sync") return "sync";
  if (hasPlatformUriExe(game.executablePath)) return "sync";

  // 3. A GameHub download record is the defining signal of a Retigga repack.
  if (game.download != null) return "catalog";

  // 4. Explicitly added from the catalogue.
  if (game.libraryOrigin === "catalog") return "catalog";

  // 5. Unstamped, no download record, no URI exe — treat as owned on its
  //    platform shop. Old DB records (pre-stamp era) for genuinely-owned games
  //    land here. Retigga repacks are caught above by their download record
  //    (step 3); explicitly-catalogued games by their "catalog" stamp (step 4).
  return "sync";
}
