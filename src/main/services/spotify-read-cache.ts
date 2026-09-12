/** Shares short-lived Connect reads between the sidebar and overlay. */
export class SpotifyReadCache {
  private entries = new Map<
    string,
    { expiresAt: number; promise: Promise<unknown> }
  >();

  constructor(
    private readonly ttlMs = 1000,
    private readonly now = Date.now
  ) {}

  read<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now())
      return entry.promise as Promise<T>;
    if (this.entries.size >= 64)
      this.entries.delete(this.entries.keys().next().value!);
    const promise = fetch().catch((error: unknown) => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, promise });
    return promise;
  }

  clear() {
    this.entries.clear();
  }
}
