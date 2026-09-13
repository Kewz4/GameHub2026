export interface AppQuitEvent {
  preventDefault(): void;
}

/**
 * Electron does not await async EventEmitter listeners. This coordinator
 * cancels the first quit synchronously, coalesces cleanup, then requests one
 * final quit after cleanup settles.
 */
export class AppQuitCleanupCoordinator {
  private cleanupPromise: Promise<void> | null = null;
  private cleanupComplete = false;

  constructor(
    private readonly runCleanup: () => Promise<void>,
    private readonly requestQuit: () => void,
    private readonly onCleanupError: (error: unknown) => void
  ) {}

  handleBeforeQuit(event: AppQuitEvent, bypassCleanup = false) {
    if (bypassCleanup || this.cleanupComplete) return;

    // This must happen before the first await. Electron does not wait for an
    // async before-quit listener to decide whether the event was cancelled.
    event.preventDefault();
    if (this.cleanupPromise) return;

    this.cleanupPromise = this.runCleanup()
      .catch((error: unknown) => this.onCleanupError(error))
      .finally(() => {
        this.cleanupComplete = true;
        this.requestQuit();
      });
  }
}
