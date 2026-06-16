import type { GameShop } from "@types";

export type GameOrigin = "sync" | "catalog" | "custom";

interface OriginSource {
  shop: GameShop;
  libraryOrigin?: "sync" | "catalog" | "custom" | null;
  executablePath?: string | null;
  download?: unknown | null;
}

/**
 * Classify how a game entered the library, for per-store library tabs.
 *
 * Rules (highest priority first):
 *   1. custom shop / "custom" stamp  → custom
 *   2. "sync" stamp                  → sync  (LOCKED — owned on platform)
 *   3. "catalog" stamp               → catalog (Playnite / catalogue / repack)
 *   4. platform URI executable       → sync  (legacy: sync handler should stamp next boot)
 *   5. download record present       → catalog (repack download)
 *   6. unstamped                     → catalog (Retigga; platform sync re-claims it)
 *
 * The `libraryOrigin` field is the single source of truth — set exclusively by
 * platform OAuth sync handlers (syncSteamLibrary, syncEpicLibrary, …). All
 * inference below is a legacy fallback for records created before the stamp
 * system existed.
 */
export function getGameOrigin(game: OriginSource): GameOrigin {
  if (game.shop === "custom" || game.libraryOrigin === "custom") return "custom";
  if (game.libraryOrigin === "sync") return "sync";
  if (game.libraryOrigin === "catalog") return "catalog";

  // Legacy fallback: platform URI schemes are written exclusively by platform
  // sync handlers, so any record with one can be treated as owned-on-platform.
  const exe = (game.executablePath ?? "").toLowerCase();
  const PLATFORM_URIS = [
    "steam://",
    "legendary://",
    "goggalaxy://",
    "goglauncher://",
    "msxbox://",
    "battlenet://",
    "origin2://",
    "uplay://",
    "riot://",
  ];
  if (PLATFORM_URIS.some((u) => exe.startsWith(u))) return "sync";

  // Repack/torrent download record → Retigga.
  if (game.download != null) return "catalog";

  // Unstamped legacy record → Retigga until next platform sync re-claims it.
  return "catalog";
}
