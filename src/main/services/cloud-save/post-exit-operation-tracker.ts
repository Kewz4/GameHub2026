export interface CloudSavePostExitDrainResult {
  drained: boolean;
  pending: number;
}

/** Tracks uploads which outlive the process-watcher tick that started them. */
export class CloudSavePostExitOperationTracker {
  private readonly active = new Set<Promise<unknown>>();

  track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => this.active.delete(tracked));
    this.active.add(tracked);
    return tracked;
  }

  get pendingCount() {
    return this.active.size;
  }

  async drain(timeoutMs: number): Promise<CloudSavePostExitDrainResult> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.active.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { drained: false, pending: this.active.size };
      }
      const snapshot = [...this.active];
      let timer: NodeJS.Timeout | undefined;
      const settled = await Promise.race([
        Promise.allSettled(snapshot).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!settled) {
        return { drained: false, pending: this.active.size };
      }
    }
    return { drained: true, pending: 0 };
  }
}

export const runAfterCloudSavePostExitDrain = async <T>(
  tracker: Pick<CloudSavePostExitOperationTracker, "drain">,
  timeoutMs: number,
  action: () => T | Promise<T>
) => {
  const drain = await tracker.drain(timeoutMs);
  return { drain, result: await action() };
};
