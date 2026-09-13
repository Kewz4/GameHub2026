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
  v2: (session: CloudSaveLaunchSession) => Promise<void>;
}

/**
 * Claims one launch session and dispatches V2 when captured at pre-launch.
 * Retired legacy or disabled sessions are completed without running a backend.
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
    if (session.mode === "v2") {
      await backends.v2(session);
    }
    return session;
  } finally {
    store.complete(objectId, shop, session.token);
  }
};
