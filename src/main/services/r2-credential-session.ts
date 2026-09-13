type R2CredentialSessionInvalidator = () => void;

const invalidators = new Set<R2CredentialSessionInvalidator>();

export const registerR2CredentialSessionInvalidator = (
  invalidator: R2CredentialSessionInvalidator
) => {
  invalidators.add(invalidator);
  return () => invalidators.delete(invalidator);
};

/** Clear every in-memory holder of account-scoped R2 capabilities. */
export const invalidateR2CredentialSession = () => {
  for (const invalidator of invalidators) invalidator();
};
