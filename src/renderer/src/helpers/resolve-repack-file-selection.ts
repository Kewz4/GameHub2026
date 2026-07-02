import type { GameRepack } from "@types";

export interface RepackFileSelection {
  fileIndices: number[];
  selectedFilesSize: number;
}

const basename = (filePath: string): string =>
  filePath.split(/[\\/]/).pop() ?? filePath;

/**
 * Resolve which file(s) of a torrent a repack actually refers to.
 *
 * Minerva/console repacks share ONE collection torrent per source (every
 * regional variant carries the same infohash), so starting the magnet without
 * selecting the repack's exact file downloads the entire archive — and the
 * post-download flatten step can then surface a wrong-region rom. This fetches
 * the torrent's file list and pins the selection to `repack.fileName`.
 *
 * Returns null when the repack carries no fileName (normal PC repacks — no
 * constraint). Throws when the torrent metadata can't be fetched or the file
 * isn't present, so callers can refuse to start an unbounded download.
 */
export async function resolveRepackFileSelection(
  repack: GameRepack,
  magnetUri: string
): Promise<RepackFileSelection | null> {
  const wanted = repack.fileName?.trim();
  if (!wanted) return null;

  const response = await window.electron.getTorrentFiles(magnetUri);
  if (!response.ok) {
    throw new Error(response.error ?? "torrent_files_unavailable");
  }

  const wantedLower = wanted.toLowerCase();
  const files = response.data.files;

  const match =
    files.find((f) => basename(f.path).toLowerCase() === wantedLower) ??
    files.find((f) => f.path.toLowerCase().endsWith(`/${wantedLower}`)) ??
    files.find((f) => f.path.toLowerCase().includes(wantedLower));

  if (!match) {
    throw new Error(`File "${wanted}" not found in torrent`);
  }

  return { fileIndices: [match.index], selectedFilesSize: match.length };
}
