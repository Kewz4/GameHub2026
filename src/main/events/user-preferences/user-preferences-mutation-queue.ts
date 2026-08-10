let mutationTail: Promise<void> = Promise.resolve();

/**
 * LevelDB updates are read/merge/write operations. Serializing them prevents
 * two rapid settings changes from reading the same old snapshot and letting
 * the later write erase an unrelated field from the earlier one.
 */
export function enqueueUserPreferencesMutation<T>(
  mutation: () => Promise<T>
): Promise<T> {
  const result = mutationTail.then(mutation, mutation);
  mutationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
