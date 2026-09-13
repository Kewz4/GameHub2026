import { setTimeout } from "node:timers/promises";
import { app } from "electron";
import type {
  GameShop,
  UnlockedAchievement,
  UpdatedUnlockedAchievements,
} from "@types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { achievementsLogger } from "../logger";
import {
  achievementSyncAttemptCount,
  achievementSyncRetryDelay,
  isRetryableAchievementSyncError,
} from "./achievement-cloud-retry-policy";
import {
  achievementPayloadFingerprint,
  canonicalizeUnlockedAchievements,
} from "./achievement-sync-policy";

export type AchievementCloudSyncStatus =
  | "synced"
  | "unchanged"
  | "logged-out"
  | "read-only"
  | "no-remote-id"
  | "account-changed"
  | "failed";

export interface AchievementCloudSyncResult {
  status: AchievementCloudSyncStatus;
  accountId: string | null;
  achievements: UnlockedAchievement[];
  response?: UpdatedUnlockedAchievements;
  attempts: number;
}

interface AchievementCloudSyncInput {
  remoteId: string | null | undefined;
  shop: GameShop;
  objectId: string;
  achievements: UnlockedAchievement[];
}

const queues = new Map<string, Promise<unknown>>();
const successfulPayloads = new Map<string, UnlockedAchievement[]>();
const remoteIdsByAccount = new Map<
  string,
  { fetchedAt: number; ids: Map<string, string> }
>();

export const getAchievementSyncAccountId = async (): Promise<string | null> => {
  if (!HydraApi.isLoggedIn()) return null;

  return db
    .get<string, { id?: string }>(levelKeys.user, { valueEncoding: "json" })
    .then((user) => user?.id ?? null)
    .catch(() => null);
};

export const resetAchievementCloudSyncSession = () => {
  queues.clear();
  successfulPayloads.clear();
  remoteIdsByAccount.clear();
};

const isSameAccount = async (accountId: string) =>
  (await getAchievementSyncAccountId()) === accountId;

const redactError = (error: unknown): string => {
  const candidate = error as {
    code?: string;
    message?: string;
    response?: { status?: number };
  };

  return candidate?.response?.status
    ? `HTTP ${candidate.response.status}`
    : (candidate?.code ?? candidate?.message ?? "unknown transport error");
};

const resolveRemoteId = async (
  accountId: string,
  requestedRemoteId: string | null | undefined,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  if (requestedRemoteId) return requestedRemoteId;

  const identity = `${shop}:${objectId}`;
  const cached = remoteIdsByAccount.get(accountId);
  const cachedId = cached?.ids.get(identity);
  if (cachedId) return cachedId;
  if (cached && Date.now() - cached.fetchedAt < 30_000) return null;

  try {
    const remoteGames =
      await HydraApi.get<
        Array<{ id: string; shop: GameShop; objectId: string }>
      >("/profile/games");
    if (!(await isSameAccount(accountId))) return null;

    const index = new Map<string, string>();
    for (const game of remoteGames ?? []) {
      if (game?.id && game?.shop && game?.objectId) {
        index.set(`${game.shop}:${game.objectId}`, game.id);
      }
    }
    remoteIdsByAccount.set(accountId, { fetchedAt: Date.now(), ids: index });
    return index.get(identity) ?? null;
  } catch (error) {
    achievementsLogger.warn(
      `[Hydra achievements] could not resolve remote game for ${identity} (${redactError(error)})`
    );
    return null;
  }
};

/**
 * Serializes idempotent achievement PUTs per account/game, retries only
 * transient failures, and fences both the request and response to the account
 * that started the operation. Tokens and achievement payloads are never logged.
 */
export const syncAchievementsToHydraCloud = async ({
  remoteId,
  shop,
  objectId,
  achievements,
}: AchievementCloudSyncInput): Promise<AchievementCloudSyncResult> => {
  if (!app.isPackaged && process.env.GAMEHUB_READ_ONLY_VISUAL_QA === "true") {
    return {
      status: "read-only",
      accountId: null,
      achievements,
      attempts: 0,
    };
  }

  const accountId = await getAchievementSyncAccountId();
  if (!accountId) {
    return {
      status: "logged-out",
      accountId: null,
      achievements,
      attempts: 0,
    };
  }

  const resolvedRemoteId = await resolveRemoteId(
    accountId,
    remoteId,
    shop,
    objectId
  );
  if (!resolvedRemoteId) {
    return {
      status: "no-remote-id",
      accountId,
      achievements,
      attempts: 0,
    };
  }

  const queueKey = `${accountId}:${shop}:${objectId}`;
  const previous = queues.get(queueKey) ?? Promise.resolve();

  const operation = previous
    .catch(() => undefined)
    .then(async (): Promise<AchievementCloudSyncResult> => {
      const payload = canonicalizeUnlockedAchievements(undefined, [
        ...(successfulPayloads.get(queueKey) ?? []),
        ...achievements,
      ]);
      const fingerprint = achievementPayloadFingerprint(payload);
      const previousFingerprint = achievementPayloadFingerprint(
        successfulPayloads.get(queueKey) ?? []
      );

      if (fingerprint === previousFingerprint && payload.length > 0) {
        return {
          status: "unchanged",
          accountId,
          achievements: payload,
          attempts: 0,
        };
      }

      for (let attempt = 0; attempt < achievementSyncAttemptCount; attempt++) {
        if (!(await isSameAccount(accountId))) {
          return {
            status: "account-changed",
            accountId,
            achievements: payload,
            attempts: attempt,
          };
        }

        const delay = achievementSyncRetryDelay(attempt);
        if (delay > 0) await setTimeout(delay);

        try {
          const response = await HydraApi.put<
            UpdatedUnlockedAchievements | undefined
          >(
            "/profile/games/achievements",
            { id: resolvedRemoteId, achievements: payload },
            {}
          );

          if (!(await isSameAccount(accountId))) {
            return {
              status: "account-changed",
              accountId,
              achievements: payload,
              attempts: attempt + 1,
            };
          }

          successfulPayloads.set(queueKey, payload);
          achievementsLogger.log(
            `[Hydra achievements] synced ${shop}:${objectId} (${payload.length} unlocks, attempt ${attempt + 1})`
          );
          return {
            status: "synced",
            accountId,
            achievements: payload,
            response,
            attempts: attempt + 1,
          };
        } catch (error) {
          const retryable = isRetryableAchievementSyncError(error);
          const finalAttempt = attempt === achievementSyncAttemptCount - 1;
          achievementsLogger.warn(
            `[Hydra achievements] ${shop}:${objectId} attempt ${attempt + 1} failed (${redactError(error)})${retryable && !finalAttempt ? "; retrying" : ""}`
          );

          if (!retryable || finalAttempt) {
            return {
              status: "failed",
              accountId,
              achievements: payload,
              attempts: attempt + 1,
            };
          }
        }
      }

      return {
        status: "failed",
        accountId,
        achievements: payload,
        attempts: achievementSyncAttemptCount,
      };
    });

  queues.set(queueKey, operation);
  return operation.finally(() => {
    if (queues.get(queueKey) === operation) queues.delete(queueKey);
  });
};
