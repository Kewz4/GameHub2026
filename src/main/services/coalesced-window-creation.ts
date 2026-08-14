/**
 * Coalesces asynchronous BrowserWindow creation without owning the window.
 *
 * The in-flight check intentionally happens before `getExisting()`: a factory
 * may publish a half-loaded BrowserWindow while it waits for the renderer-ready
 * handshake. Concurrent callers must await that same handshake, not receive the
 * half-loaded window and send IPC before the renderer subscribes.
 */
export class CoalescedWindowCreation<T> {
  private pending: Promise<T | null> | null = null;

  public getOrCreate(
    getExisting: () => T | null,
    create: () => Promise<T | null>
  ): Promise<T | null> {
    if (this.pending) return this.pending;

    const existing = getExisting();
    if (existing) return Promise.resolve(existing);

    const pending = create().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  public async waitForPending(): Promise<T | null> {
    return this.pending?.catch(() => null) ?? null;
  }
}
