import { UserNotLoggedInError } from "@shared";

import { HydraApi } from "../hydra-api";

export const canAccessCloudSaves = (
  isLoggedIn: boolean,
  _hasActiveSubscription: boolean
) => isLoggedIn;

/**
 * GameHub Cloud Saves are free, but the R2 broker needs an authenticated Hydra
 * profile to mint credentials scoped to that account's private namespace.
 */
export const assertCloudSaveSubscription = (
  isLoggedIn = HydraApi.isLoggedIn(),
  _hasActiveSubscription?: boolean
) => {
  if (!isLoggedIn) throw new UserNotLoggedInError();
};
