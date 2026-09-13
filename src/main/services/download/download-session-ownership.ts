export interface DownloadSessionIdentity {
  downloadKey: string;
  generation: number;
}

export interface MissingDownloadObservation {
  candidate: DownloadSessionIdentity | null;
  shouldCancel: boolean;
}

export const ownsDownloadSession = (
  currentDownloadKey: string | null,
  currentGeneration: number,
  expected: DownloadSessionIdentity
) => {
  return (
    currentDownloadKey === expected.downloadKey &&
    currentGeneration === expected.generation
  );
};

/**
 * Require the same missing record to be observed twice for the same session.
 * A restart of the same game advances the generation and therefore cannot be
 * cancelled by a stale observation from the previous transfer.
 */
export const observeMissingDownload = (
  candidate: DownloadSessionIdentity | null,
  observed: DownloadSessionIdentity
): MissingDownloadObservation => {
  if (
    candidate?.downloadKey === observed.downloadKey &&
    candidate.generation === observed.generation
  ) {
    return { candidate: null, shouldCancel: true };
  }

  return { candidate: observed, shouldCancel: false };
};
