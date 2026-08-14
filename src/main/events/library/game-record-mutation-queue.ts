const mutationTails = new Map<string, Promise<void>>();

/** Serializes read/merge/write mutations for one library record. */
export function enqueueGameRecordMutation<T>(
  gameKey: string,
  mutation: () => Promise<T>
): Promise<T> {
  const previous = mutationTails.get(gameKey) ?? Promise.resolve();
  const result = previous.then(mutation, mutation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );

  mutationTails.set(gameKey, tail);
  void tail.finally(() => {
    if (mutationTails.get(gameKey) === tail) {
      mutationTails.delete(gameKey);
    }
  });

  return result;
}
