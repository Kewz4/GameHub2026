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
 * Hard requirement (locked model — v4.6.4):
 *   • Steam / Epic / GOG / … platform tabs contain ONLY games that came from
 *     that platform's login/OAuth SYNC import. Nothing inferred, nothing
 *     scanned, no catalogue/Playnite match — purely games a platform sync
 *     handler explicitly stamped `libraryOrigin: "sync"`.
 *   • Retigga (catalog) = Playnite imports + Hydra catalogue adds + repacks
 *     (anything with a GameHub download record), plus any legacy/unverified
 *     record we can't prove is a platform sync.
 *   • Custom = manually added games + disk-scan auto-detected games.
 *
 * The decision is therefore made on EXPLICIT signals only — the stored
 * `libraryOrigin` stamp and the presence of a download record. We deliberately
 * do NOT infer ownership from a platform-URI executable: repack launchers
 * (goggalaxy://openGame, legendary://run) also produce URI exes, so inferring
 * "sync" from the exe is exactly what leaked repacks/imports into the platform
 * tabs. A genuine platform sync always writes `libraryOrigin: "sync"`, so the
 * stamp alone is sufficient and authoritative.
 */
export function getGameOrigin(game: OriginSource): GameOrigin {
  // 1. Manually added games.
  if (game.shop === "custom" || game.libraryOrigin === "custom") {
    return "custom";
  }

  // 2. A GameHub download record is the defining signal of a Retigga repack —
  //    checked before "sync" so a repack can never sit in a platform tab even
  //    if some legacy stamp wrongly marked it.
  if (game.download != null) return "catalog";

  // 3. Explicitly added from the catalogue / imported from Playnite.
  if (game.libraryOrigin === "catalog") return "catalog";

  // 4. Owned via a platform login/OAuth sync — the ONLY way into a store tab.
  if (game.libraryOrigin === "sync") return "sync";

  // 5. Unstamped / unverified legacy record. Never a platform tab — send it to
  //    Retigga. A real platform sync will stamp it "sync" and move it to its
  //    store tab on the next run.
  return "catalog";
}
