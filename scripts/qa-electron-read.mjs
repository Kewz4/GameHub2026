/** Electron/V8 inspector bootstrap can lose an internal promise under GC.
 * Use only for idempotent reads; never retry a callback with side effects. */
export async function readElectronMainWithRetry(
  read,
  onRetry = () => undefined
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (
        attempt === 3 ||
        !/Resulting promise was garbage collected/i.test(
          String(error?.message ?? error)
        )
      )
        throw error;
      onRetry(attempt);
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
  throw new Error("Electron main-process read did not complete.");
}
