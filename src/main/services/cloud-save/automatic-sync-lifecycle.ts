import type { CloudSaveAutomaticSyncMode, GameShop } from "@types";

import { logger } from "../logger";
import { getCloudSaveAutomaticSyncMode } from "./automatic-sync-settings";
import {
  canCreateCloudSaveUploadGuard,
  cloudSaveLaunchSessions,
  clearCloudSaveLaunchGuard,
  markCloudSaveLaunchSessionPending,
  startCloudSaveLaunchSession,
  shouldBlockGameLaunchForCloudSave,
  updateCloudSaveLaunchSession,
} from "./launch-guard";
import {
  runAutomaticCloudSavePostExit,
  runAutomaticCloudSaveSyncDetailed,
} from "./automatic-sync";
import {
  getCloudSaveGameContext,
  type CloudSaveGameContextOverrides,
} from "./cloud-save-game-context";
import {
  createPendingCloudSaveCustomPathApproval,
  type CloudSavePendingLaunchOptions,
} from "./custom-path-approval";
import { shouldRunV2AutomaticCloudSave } from "./automatic-sync-mode";
import { finalizeCloudSaveLaunchSession } from "./launch-session-finalizer";

export interface AutomaticCloudSaveLaunchPreparation {
  mode: CloudSaveAutomaticSyncMode;
  sessionToken: string | null;
  shouldLaunch: boolean;
  blockReason: "custom-path-approval" | "conflict" | "restore-failed" | null;
}

/** Prepare one automatic Cloud Saves V2 launch session. */
export const prepareAutomaticCloudSaveLaunch = async (
  objectId: string,
  shop: GameShop,
  contextOverrides?: CloudSaveGameContextOverrides,
  pendingLaunchOptions?: CloudSavePendingLaunchOptions
): Promise<AutomaticCloudSaveLaunchPreparation> => {
  const mode = await getCloudSaveAutomaticSyncMode(objectId, shop).catch(
    (error: unknown) => {
      logger.error("[Cloud Save] Failed to read automatic sync mode", {
        shop,
        objectId,
        phase: "pre-launch",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return "disabled" as const;
    }
  );

  const session = startCloudSaveLaunchSession(objectId, shop, mode);

  try {
    if (!shouldRunV2AutomaticCloudSave(mode)) {
      if (!markCloudSaveLaunchSessionPending(objectId, shop, session.token)) {
        throw new Error("cloud_save_launch_session_lost");
      }
      return {
        mode,
        sessionToken: session.token,
        shouldLaunch: true,
        blockReason: null,
      };
    }

    const context = await getCloudSaveGameContext(
      objectId,
      shop,
      contextOverrides
    ).catch((error: unknown) => {
      logger.error("[Cloud Save] Failed to resolve pre-launch environment", {
        shop,
        objectId,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    const customPathApproval =
      context && pendingLaunchOptions
        ? await createPendingCloudSaveCustomPathApproval(
            pendingLaunchOptions,
            context
          ).catch((error: unknown) => {
            logger.error(
              "[Cloud Save] Failed to inspect custom restore destinations",
              {
                shop,
                objectId,
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              }
            );
            return null;
          })
        : null;

    if (customPathApproval) {
      logger.warn(
        "[Cloud Save] Launch blocked by an unapproved custom restore path",
        {
          shop,
          objectId,
          rawPath: customPathApproval.rawPath,
        }
      );
      clearCloudSaveLaunchGuard(objectId, shop, session.token);
      return {
        mode,
        sessionToken: null,
        shouldLaunch: false,
        blockReason: "custom-path-approval",
      };
    }

    const outcome = await runAutomaticCloudSaveSyncDetailed(
      objectId,
      shop,
      "pre-launch",
      context ?? undefined,
      undefined,
      session.token
    );
    const result = outcome.result;
    const restoreFailed = outcome.status === "failed";

    if (shouldBlockGameLaunchForCloudSave(result, restoreFailed)) {
      logger.warn("[Cloud Save] Launch blocked by pre-launch V2 sync", {
        shop,
        objectId,
        reason: result?.action === "conflict" ? "conflict" : "restore_failed",
        errorCode: "errorCode" in outcome ? outcome.errorCode : undefined,
      });
      clearCloudSaveLaunchGuard(objectId, shop, session.token);
      return {
        mode,
        sessionToken: null,
        shouldLaunch: false,
        blockReason:
          result?.action === "conflict" ? "conflict" : "restore-failed",
      };
    }

    if (context) {
      updateCloudSaveLaunchSession(objectId, shop, session.token, {
        environmentId: context.environmentId,
        baseRemoteHash: result?.remoteHash ?? null,
        uploadAllowed: canCreateCloudSaveUploadGuard(
          context.prefixIdentityMode !== "session",
          context.environmentId,
          result
        ),
      });
    }
    if (!markCloudSaveLaunchSessionPending(objectId, shop, session.token)) {
      throw new Error("cloud_save_launch_session_lost");
    }

    return {
      mode,
      sessionToken: session.token,
      shouldLaunch: true,
      blockReason: null,
    };
  } catch (error) {
    clearCloudSaveLaunchGuard(objectId, shop, session.token);
    throw error;
  }
};

/** Run the V2 post-exit sync captured by the launch session. */
export const runAutomaticCloudSaveAfterExit = async (
  objectId: string,
  shop: GameShop,
  expectedSessionToken?: string
) => {
  if (!expectedSessionToken) {
    logger.warn("[Cloud Save] Ignoring unowned game exit", {
      shop,
      objectId,
    });
    return;
  }

  const finalized = await finalizeCloudSaveLaunchSession(
    cloudSaveLaunchSessions,
    objectId,
    shop,
    {
      v2: async (session) => {
        await runAutomaticCloudSavePostExit(objectId, shop, session);
      },
    },
    expectedSessionToken
  );

  if (!finalized) {
    logger.warn("[Cloud Save] Ignoring exit without an active launch session", {
      shop,
      objectId,
    });
  }
};
