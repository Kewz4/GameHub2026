/**
 * Library installation audit types (shared main <-> renderer).
 */

export interface LibraryInstallationReport {
  total: number;
  installed: number;
  notInstalled: number;
  /** Games whose executable/disc vanished from disk (stale "installed" flag). */
  stale: Array<{
    title: string;
    shop: string;
    objectId: string;
    path: string;
  }>;
  /** Games found on disk but not marked installed (healed in one pass). */
  found: Array<{ title: string; shop: string; objectId: string; path: string }>;
}
