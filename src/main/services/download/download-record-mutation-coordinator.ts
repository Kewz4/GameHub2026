/**
 * Serializes writes made by a live downloader with cancellation/replacement of
 * its persisted row. Ownership is evaluated only after the operation reaches
 * the front of the chain, so a stale poll queued behind a replacement cannot
 * write into the replacement record.
 */
export class DownloadRecordMutationCoordinator {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  runOwned<T>(
    ownsSession: () => boolean,
    operation: () => Promise<T>
  ): Promise<T | null> {
    return this.run(async () => {
      if (!ownsSession()) return null;
      return operation();
    });
  }

  replace<T>(cancelOwner: () => Promise<void>, install: () => Promise<T>) {
    return this.run(async () => {
      await cancelOwner();
      return install();
    });
  }
}
