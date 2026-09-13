export const PREPARED_JS_DOWNLOAD_TTL_MS = 120_000;

interface PreparedJsDownload<T> {
  resolvedAt: number;
  options: T;
}

/**
 * Keeps a validated provider response alive just long enough for the queued
 * download to start. Entries are scoped to both the library download and its
 * exact source URI so overlapping validations cannot consume one another.
 */
export class PreparedJsDownloadCache<T> {
  private readonly entries = new Map<
    string,
    Map<string, PreparedJsDownload<T>>
  >();

  constructor(
    private readonly ttlMs = PREPARED_JS_DOWNLOAD_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  set(downloadId: string, sourceUri: string, options: T) {
    this.pruneExpired();

    const downloadsByUri = this.entries.get(downloadId) ?? new Map();
    downloadsByUri.set(sourceUri, {
      resolvedAt: this.now(),
      options,
    });
    this.entries.set(downloadId, downloadsByUri);
  }

  delete(downloadId: string, sourceUri: string) {
    const downloadsByUri = this.entries.get(downloadId);
    if (!downloadsByUri) return;

    downloadsByUri.delete(sourceUri);
    if (downloadsByUri.size === 0) this.entries.delete(downloadId);
  }

  take(downloadId: string, sourceUri: string): T | null {
    const downloadsByUri = this.entries.get(downloadId);
    if (!downloadsByUri) {
      this.pruneExpired();
      return null;
    }

    const prepared = downloadsByUri.get(sourceUri);

    if (!prepared) {
      this.pruneExpired();
      return null;
    }

    downloadsByUri.delete(sourceUri);
    if (downloadsByUri.size === 0) this.entries.delete(downloadId);

    const age = this.now() - prepared.resolvedAt;
    if (age < 0 || age > this.ttlMs) return null;

    return prepared.options;
  }

  private pruneExpired() {
    const now = this.now();

    for (const [downloadId, downloadsByUri] of this.entries) {
      for (const [sourceUri, prepared] of downloadsByUri) {
        const age = now - prepared.resolvedAt;
        if (age < 0 || age > this.ttlMs) {
          downloadsByUri.delete(sourceUri);
        }
      }

      if (downloadsByUri.size === 0) this.entries.delete(downloadId);
    }
  }
}
