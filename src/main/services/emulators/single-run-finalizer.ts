/** Coalesce every terminal signal for one session into one async finalizer. */
export const createSingleRunFinalizer = <T>(operation: () => Promise<T>) => {
  let result: Promise<T> | null = null;

  return (): Promise<T> => {
    result ??= Promise.resolve().then(operation);
    return result;
  };
};
