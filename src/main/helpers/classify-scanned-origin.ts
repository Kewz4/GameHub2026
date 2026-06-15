type LibraryOrigin = "sync" | "catalog" | "custom";

/**
 * Decide the libraryOrigin for a game whose executable was found by a disk
 * scan. A disk scan only proves the game is installed on this machine — NOT
 * that it was imported from a platform login/OAuth sync. Under the locked
 * filtering model (v4.6.4) the platform tabs (Steam/Epic/GOG/…) are reserved
 * exclusively for games that came from their sync import, so a scan may never
 * promote a game to "sync".
 *
 * Therefore: keep whatever origin the game already had (e.g. a genuine prior
 * "sync" stamp from a platform import, or a "catalog" repack), and otherwise
 * classify a freshly-discovered game as "custom" — auto-detected games live in
 * the Custom tab alongside manual adds.
 */
export function classifyScannedOrigin(
  _executablePath: string,
  existingOrigin?: LibraryOrigin
): LibraryOrigin {
  return existingOrigin ?? "custom";
}
