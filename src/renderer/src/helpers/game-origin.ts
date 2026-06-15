import type { GameShop } from "@types";

export type GameOrigin = "sync" | "catalog" | "custom";

interface OriginSource {
  shop: GameShop;
  libraryOrigin?: GameOrigin | null;
  executablePath?: string | null;
  /** A GameHub repack/torrent download record, when one exists. */
  download?: unknown | null;
}

/**
 * Classify how a game entered the library, for the per-store library tabs.
 *
 * Locked model: `libraryOrigin: "sync"` is AUTHORITATIVE and wins over
 * everything else. Only a platform login/OAuth sync handler ever writes it
 * (sync-steam-library, sync-epic-library, …), so once a game is stamped
 * "sync" it is locked to its store tab — a later repack download or a stale
 * Playnite "catalog" stamp can never pull it out. This is what the user asked
 * for: "lock the category so no games go out of it".
 *
 *   1. custom shop / "custom" stamp     → custom
 *   2. "sync" stamp                     → sync    (LOCKED — owned on platform)
 *   3. GameHub download record          → catalog (a repack → Retigga)
 *   4. "catalog" stamp                  → catalog (Playnite / catalogue add)
 *   5. unstamped / unverified           → catalog (Retigga; sync re-claims it)
 */
export function getGameOrigin(game: OriginSource): GameOrigin {
  // 1. Manually added games.
  if (game.shop === "custom" || game.libraryOrigin === "custom") {
    return "custom";
  }

  // 2. Owned via a platform login/OAuth sync — locked to its store tab.
  if (game.libraryOrigin === "sync") return "sync";

  // 3. A GameHub download record means a Retigga repack.
  if (game.download != null) return "catalog";

  // 4. Explicitly added from the catalogue / imported from Playnite.
  if (game.libraryOrigin === "catalog") return "catalog";

  // 5. Unstamped / unverified legacy record → Retigga. A real platform sync
  //    will stamp it "sync" and move it to its store tab on its next run.
  return "catalog";
}
