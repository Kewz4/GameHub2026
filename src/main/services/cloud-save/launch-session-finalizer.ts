import type { GameShop } from "@types";

import type { CloudSaveLaunchSession } from "./launch-guard";

export interface CloudSaveLaunchSessionFinalizationStore {
  claimFinalization(
    objectId: string,
    shop: GameShop,
    expectedToken?: string
  ): CloudSaveLaunchSession | null;
  complete(objectId: string, shop: GameShop, token: string): boolean;
}

export interface CloudSaveLaunchSessionBackends {
  legacy: (session: CloudSaveLaunchSession) => Promise<void>;
  v2: (session: CloudSaveLaunchSession) => Promise<void>;
}

/**
 * Claims one launch session and dispatches the backend captured at pre-launch.
 * A concurrent or duplicate exit observes the finalizing phase and is a no-op.
 */
export const finalizeCloudSaveLaunchSession = async (
  store: CloudSaveLaunchSessionFinalizationStore,
  objectId: string,
  shop: GameShop,
  backends: CloudSaveLaunchSessionBackends,
  expectedToken?: string
): Promise<CloudSaveLaunchSession | null> => {
  const session = store.claimFinalization(objectId, shop, expectedToken);
  if (!session) return null;

  try {
    if (session.mode === "legacy") {
      await backends.legacy(session);
    } else if (session.mode === "v2") {
      await backends.v2(session);
    }
    return session;
  } finally {
    store.complete(objectId, shop, session.token);
  }
};
