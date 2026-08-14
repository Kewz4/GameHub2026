import { randomUUID } from "node:crypto";

import type {
  CloudSaveAutomaticSyncMode,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";

export type CloudSaveLaunchSessionPhase =
  | "preparing"
  | "pending"
  | "running"
  | "finalizing";

export interface CloudSaveLaunchSession {
  token: string;
  objectId: string;
  shop: GameShop;
  mode: CloudSaveAutomaticSyncMode;
  phase: CloudSaveLaunchSessionPhase;
  environmentId: string | null;
  baseRemoteHash: string | null;
  uploadAllowed: boolean;
  createdAt: string;
}

/** The V2 portion retained for callers which only need upload validation. */
export type CloudSaveLaunchGuard = Pick<
  CloudSaveLaunchSession,
  "environmentId" | "baseRemoteHash" | "uploadAllowed" | "createdAt"
>;

type LaunchSessionReservation = (scopeKey: string, token: string) => void;
type LaunchSessionRelease = (scopeKey: string, token: string) => void;

const getKey = (objectId: string, shop: GameShop) =>
  cloudSaveOperationScopeKey(objectId, shop);

const copySession = (
  session: CloudSaveLaunchSession
): CloudSaveLaunchSession => ({ ...session });

/**
 * Owns the full pre-launch -> game-running -> post-exit lifecycle. A game can
 * have at most one live session and finalization can be claimed exactly once.
 */
export class CloudSaveLaunchSessionStore {
  private readonly sessions = new Map<string, CloudSaveLaunchSession>();

  public constructor(
    private readonly reserve: LaunchSessionReservation = () => undefined,
    private readonly release: LaunchSessionRelease = () => undefined
  ) {}

  public start(
    objectId: string,
    shop: GameShop,
    mode: CloudSaveAutomaticSyncMode,
    initial?: Partial<
      Pick<
        CloudSaveLaunchSession,
        "environmentId" | "baseRemoteHash" | "uploadAllowed" | "createdAt"
      >
    >
  ): CloudSaveLaunchSession {
    const key = getKey(objectId, shop);
    if (this.sessions.has(key)) {
      throw new Error("cloud_save_launch_active");
    }

    const session: CloudSaveLaunchSession = {
      token: randomUUID(),
      objectId,
      shop,
      mode,
      phase: "preparing",
      environmentId: initial?.environmentId ?? null,
      baseRemoteHash: initial?.baseRemoteHash ?? null,
      uploadAllowed: initial?.uploadAllowed ?? false,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };

    this.reserve(key, session.token);
    this.sessions.set(key, session);
    return copySession(session);
  }

  public update(
    objectId: string,
    shop: GameShop,
    token: string,
    update: Partial<
      Pick<
        CloudSaveLaunchSession,
        "environmentId" | "baseRemoteHash" | "uploadAllowed"
      >
    >
  ): CloudSaveLaunchSession | null {
    const session = this.getOwned(objectId, shop, token);
    if (!session || session.phase === "finalizing") return null;
    Object.assign(session, update);
    return copySession(session);
  }

  public markPending(
    objectId: string,
    shop: GameShop,
    token: string
  ): CloudSaveLaunchSession | null {
    return this.setPhase(objectId, shop, token, "pending");
  }

  public markRunning(
    objectId: string,
    shop: GameShop,
    token?: string
  ): CloudSaveLaunchSession | null {
    const session = token
      ? this.getOwned(objectId, shop, token)
      : this.sessions.get(getKey(objectId, shop));
    if (!session || session.phase === "finalizing") return null;
    session.phase = "running";
    return copySession(session);
  }

  public claimFinalization(
    objectId: string,
    shop: GameShop,
    expectedToken?: string
  ): CloudSaveLaunchSession | null {
    const session = this.sessions.get(getKey(objectId, shop));
    if (
      !session ||
      session.phase === "finalizing" ||
      (expectedToken !== undefined && session.token !== expectedToken)
    ) {
      return null;
    }
    session.phase = "finalizing";
    return copySession(session);
  }

  public complete(objectId: string, shop: GameShop, token: string): boolean {
    return this.removeOwned(objectId, shop, token);
  }

  public abort(objectId: string, shop: GameShop, token?: string): boolean {
    const session = this.sessions.get(getKey(objectId, shop));
    if (!session || (token !== undefined && session.token !== token)) {
      return false;
    }
    return this.removeOwned(objectId, shop, session.token);
  }

  /** Abort only a launch which never reached a detected running process. */
  public abortPending(
    objectId: string,
    shop: GameShop,
    token: string
  ): boolean {
    const session = this.getOwned(objectId, shop, token);
    if (
      !session ||
      (session.phase !== "preparing" && session.phase !== "pending")
    ) {
      return false;
    }
    return this.removeOwned(objectId, shop, token);
  }

  public get(objectId: string, shop: GameShop): CloudSaveLaunchSession | null {
    const session = this.sessions.get(getKey(objectId, shop));
    return session ? copySession(session) : null;
  }

  private getOwned(objectId: string, shop: GameShop, token: string) {
    const session = this.sessions.get(getKey(objectId, shop));
    return session?.token === token ? session : null;
  }

  private setPhase(
    objectId: string,
    shop: GameShop,
    token: string,
    phase: CloudSaveLaunchSessionPhase
  ): CloudSaveLaunchSession | null {
    const session = this.getOwned(objectId, shop, token);
    if (!session || session.phase === "finalizing") return null;
    session.phase = phase;
    return copySession(session);
  }

  private removeOwned(objectId: string, shop: GameShop, token: string) {
    const key = getKey(objectId, shop);
    if (this.sessions.get(key)?.token !== token) return false;
    this.sessions.delete(key);
    this.release(key, token);
    return true;
  }
}

export const cloudSaveLaunchSessions = new CloudSaveLaunchSessionStore(
  (scopeKey, token) =>
    cloudSaveOperationGate.reserveLaunchSession(scopeKey, token),
  (scopeKey, token) => {
    cloudSaveOperationGate.releaseLaunchSession(scopeKey, token);
  }
);

export const startCloudSaveLaunchSession = (
  objectId: string,
  shop: GameShop,
  mode: CloudSaveAutomaticSyncMode
) => cloudSaveLaunchSessions.start(objectId, shop, mode);

export const updateCloudSaveLaunchSession = (
  objectId: string,
  shop: GameShop,
  token: string,
  update: Partial<
    Pick<
      CloudSaveLaunchSession,
      "environmentId" | "baseRemoteHash" | "uploadAllowed"
    >
  >
) => cloudSaveLaunchSessions.update(objectId, shop, token, update);

export const markCloudSaveLaunchSessionPending = (
  objectId: string,
  shop: GameShop,
  token: string
) => cloudSaveLaunchSessions.markPending(objectId, shop, token);

export const markCloudSaveLaunchSessionRunning = (
  objectId: string,
  shop: GameShop,
  token?: string
) => cloudSaveLaunchSessions.markRunning(objectId, shop, token);

export const claimCloudSaveLaunchSessionFinalization = (
  objectId: string,
  shop: GameShop,
  expectedToken?: string
) => cloudSaveLaunchSessions.claimFinalization(objectId, shop, expectedToken);

export const completeCloudSaveLaunchSession = (
  objectId: string,
  shop: GameShop,
  token: string
) => cloudSaveLaunchSessions.complete(objectId, shop, token);

export const getCloudSaveLaunchSession = (objectId: string, shop: GameShop) =>
  cloudSaveLaunchSessions.get(objectId, shop);

export const clearCloudSaveLaunchGuard = (
  objectId: string,
  shop: GameShop,
  token?: string
) => cloudSaveLaunchSessions.abort(objectId, shop, token);

export const clearPendingCloudSaveLaunchSession = (
  objectId: string,
  shop: GameShop,
  token: string
) => cloudSaveLaunchSessions.abortPending(objectId, shop, token);

/** @deprecated Prefer startCloudSaveLaunchSession for full session ownership. */
export const setCloudSaveLaunchGuard = (
  objectId: string,
  shop: GameShop,
  guard: CloudSaveLaunchGuard
) => {
  const session = cloudSaveLaunchSessions.start(objectId, shop, "v2", guard);
  cloudSaveLaunchSessions.markPending(objectId, shop, session.token);
  return session;
};

/** @deprecated Finalizers should claim then complete the full session. */
export const consumeCloudSaveLaunchGuard = (
  objectId: string,
  shop: GameShop
) => {
  const session = cloudSaveLaunchSessions.claimFinalization(objectId, shop);
  if (!session) return null;
  cloudSaveLaunchSessions.complete(objectId, shop, session.token);
  return session;
};

export const canUploadCloudSaveAfterLaunch = (
  guard: CloudSaveLaunchGuard | null,
  currentEnvironmentId: string
) =>
  guard?.uploadAllowed === true && guard.environmentId === currentEnvironmentId;

export const canCreateCloudSaveUploadGuard = (
  preparationSafe: boolean,
  environmentId: string,
  preLaunchResult: SyncGameCloudSaveResult | null
) =>
  preparationSafe &&
  preLaunchResult !== null &&
  preLaunchResult.trigger === "pre-launch" &&
  preLaunchResult.environmentId === environmentId &&
  preLaunchResult.action !== "conflict" &&
  preLaunchResult.finalState !== "partial";

export const shouldBlockGameLaunchForCloudSave = (
  preLaunchResult: SyncGameCloudSaveResult | null,
  restoreFailed = false
) =>
  restoreFailed ||
  (preLaunchResult?.trigger === "pre-launch" &&
    preLaunchResult.action === "conflict");
