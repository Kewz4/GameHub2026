import type {
  CloudSaveAutomaticSyncEvent,
  CloudSaveAutomaticSyncTrigger,
  CloudSaveSyncProgressStage,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import {
  getCloudSaveAccountScopeKey,
  runWithCloudSaveAccountSession,
} from "./account-session";
import { getCloudSaveAutomaticSyncEnabled } from "./automatic-sync-settings";
import { syncGameCloudSave } from "./sync-game-cloud-save";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getCloudSaveErrorDetails } from "./cloud-save-error-details";
import { isCloudSaveEnvironmentChangedError } from "./environment-guard";
import { isCloudSaveExecutableMissingError } from "./executable-path-guard";
import {
  canUploadCloudSaveAfterLaunch,
  type CloudSaveLaunchSession,
} from "./launch-guard";
import { CloudSaveOperationCoordinator } from "./operation-coordinator";
import {
  classifyAutomaticCloudSaveFailure,
  getPendingDeletionAutomaticSyncOutcome,
  type AutomaticCloudSaveSyncOutcome,
} from "./automatic-sync-outcome";
import { isCloudSaveDeletionPending } from "./pending-deletion";
import {
  beginAutomaticSyncObservation,
  finishAutomaticSyncObservation,
} from "./automatic-sync-observation";

const automaticSyncCoordinator =
  new CloudSaveOperationCoordinator<AutomaticCloudSaveSyncOutcome>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([getCloudSaveAccountScopeKey(), shop, objectId]);

const isPendingDeletionBlockingAutomaticSync = async (
  objectId: string,
  shop: GameShop,
  trigger?: CloudSaveAutomaticSyncTrigger
) =>
  isCloudSaveDeletionPending(objectId, shop).catch((error: unknown) => {
    logger.error("[Cloud Save] Failed to inspect pending deletion", {
      shop,
      objectId,
      trigger,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return true;
  });

export const canRunAutomaticCloudSaveSync = async (
  objectId: string,
  shop: GameShop
) => {
  if (
    (await isPendingDeletionBlockingAutomaticSync(objectId, shop)) ||
    !(await getCloudSaveAutomaticSyncEnabled(objectId, shop))
  ) {
    return false;
  }
  return true;
};

const emitAutomaticSyncEvent = (event: CloudSaveAutomaticSyncEvent) => {
  WindowManager.sendToAppWindows("on-cloud-save-automatic-sync", event);
};

const runAutomaticCloudSaveSyncDetailedInAccount = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null,
  launchSessionToken?: string
): Promise<AutomaticCloudSaveSyncOutcome> => {
  const pendingDeletionOutcome = getPendingDeletionAutomaticSyncOutcome(
    await isPendingDeletionBlockingAutomaticSync(objectId, shop, trigger)
  );
  if (pendingDeletionOutcome) {
    logger.warn("[Cloud Save] Automatic sync blocked by pending deletion", {
      shop,
      objectId,
      trigger,
    });
    emitAutomaticSyncEvent({
      gameId: { objectId, shop },
      trigger,
      status: "cancelled",
    });
    return pendingDeletionOutcome;
  }

  // A launch session freezes V2 eligibility. Mode changes made while a game is
  // preparing/running apply to the next launch; legacy sessions are retired.
  if (
    launchSessionToken === undefined &&
    !(await getCloudSaveAutomaticSyncEnabled(objectId, shop))
  ) {
    return { status: "skipped", result: null };
  }

  let contextResolutionFailed = false;
  const context =
    suppliedContext ??
    (await getCloudSaveGameContext(objectId, shop).catch((error: unknown) => {
      logger.error("[Cloud Save] Failed to resolve automatic sync context", {
        shop,
        objectId,
        trigger,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      emitAutomaticSyncEvent({
        gameId: { objectId, shop },
        trigger,
        status: "failed",
      });
      contextResolutionFailed = true;
      return null;
    }));
  if (!context) {
    return {
      status: contextResolutionFailed
        ? classifyAutomaticCloudSaveFailure(trigger)
        : "skipped",
      result: null,
    };
  }
  const key = gameKey(objectId, shop);
  const operationKey = JSON.stringify([
    trigger,
    context.environmentId,
    expectedRemoteHash === undefined
      ? ["anchor"]
      : ["expected", expectedRemoteHash],
  ]);

  return automaticSyncCoordinator.run(key, operationKey, async () => {
    const accountScopeKey = getCloudSaveAccountScopeKey();
    const observation =
      trigger === "game-page-open"
        ? beginAutomaticSyncObservation(
            objectId,
            shop,
            trigger,
            Date.now(),
            accountScopeKey
          )
        : ({
            accepted: true,
            observationKey: null,
            sessionGeneration: -1,
          } as const);
    if (!observation.accepted) {
      return { status: "skipped", result: null };
    }

    let latestStage: CloudSaveSyncProgressStage | undefined;
    return syncGameCloudSave(
      objectId,
      shop,
      trigger,
      (progress) => {
        latestStage = progress.stage;
        emitAutomaticSyncEvent({
          gameId: { objectId, shop },
          trigger,
          status: "progress",
          progress,
        });
      },
      context,
      expectedRemoteHash,
      launchSessionToken
    )
      .then((result) => {
        const status = result.action === "conflict" ? "conflict" : "completed";
        finishAutomaticSyncObservation(
          objectId,
          shop,
          trigger,
          observation.observationKey,
          "settled",
          Date.now(),
          accountScopeKey,
          observation.sessionGeneration
        );
        logger.info("[Cloud Save] Automatic sync finished", {
          shop,
          objectId,
          trigger,
          action: result.action,
          initialState: result.initialState,
          finalState: result.finalState,
        });
        emitAutomaticSyncEvent({
          gameId: { objectId, shop },
          trigger,
          status,
          result,
        });
        return { status: "completed", result } as const;
      })
      .catch((error: unknown) => {
        finishAutomaticSyncObservation(
          objectId,
          shop,
          trigger,
          observation.observationKey,
          "failed",
          Date.now(),
          accountScopeKey,
          observation.sessionGeneration
        );
        const environmentChanged = isCloudSaveEnvironmentChangedError(error);
        const executableMissing = isCloudSaveExecutableMissingError(error);
        if (environmentChanged || executableMissing) {
          logger.info("[Cloud Save] Automatic sync cancelled", {
            shop,
            objectId,
            trigger,
            reason: executableMissing
              ? "executable_missing"
              : "environment_changed",
          });
          emitAutomaticSyncEvent({
            gameId: { objectId, shop },
            trigger,
            status: "cancelled",
          });
          return { status: "cancelled", result: null } as const;
        }
        const errorDetails = getCloudSaveErrorDetails(error);
        logger.error("[Cloud Save] Automatic sync failed", {
          shop,
          objectId,
          trigger,
          ...errorDetails,
        });
        emitAutomaticSyncEvent({
          gameId: { objectId, shop },
          trigger,
          status: "failed",
          errorCode:
            typeof errorDetails.errorCode === "string"
              ? errorDetails.errorCode
              : undefined,
        });
        return {
          status: classifyAutomaticCloudSaveFailure(trigger, latestStage),
          result: null,
          errorCode:
            typeof errorDetails.errorCode === "string"
              ? errorDetails.errorCode
              : undefined,
        } as AutomaticCloudSaveSyncOutcome;
      });
  });
};

export const runAutomaticCloudSaveSyncDetailed = (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null,
  launchSessionToken?: string
): Promise<AutomaticCloudSaveSyncOutcome> =>
  runWithCloudSaveAccountSession(() =>
    runAutomaticCloudSaveSyncDetailedInAccount(
      objectId,
      shop,
      trigger,
      suppliedContext,
      expectedRemoteHash,
      launchSessionToken
    )
  );

export const runAutomaticCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null,
  launchSessionToken?: string
): Promise<SyncGameCloudSaveResult | null> =>
  (
    await runAutomaticCloudSaveSyncDetailed(
      objectId,
      shop,
      trigger,
      suppliedContext,
      expectedRemoteHash,
      launchSessionToken
    )
  ).result;

const runAutomaticCloudSavePostExitInAccount = async (
  objectId: string,
  shop: GameShop,
  session: CloudSaveLaunchSession
): Promise<SyncGameCloudSaveResult | null> => {
  if (!session.uploadAllowed) {
    logger.warn("[Cloud Save] Post-exit upload blocked by launch guard", {
      shop,
      objectId,
      reason: "pre_launch_not_safe",
    });
    return null;
  }

  const context = await getCloudSaveGameContext(objectId, shop).catch(
    (error: unknown) => {
      logger.error("[Cloud Save] Failed to verify post-exit environment", {
        shop,
        objectId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    }
  );
  if (
    !context ||
    !canUploadCloudSaveAfterLaunch(session, context.environmentId)
  ) {
    logger.warn(
      "[Cloud Save] Post-exit upload blocked after environment change",
      {
        shop,
        objectId,
      }
    );
    return null;
  }

  return runAutomaticCloudSaveSync(
    objectId,
    shop,
    "post-exit",
    context,
    session.baseRemoteHash,
    session.token
  );
};

export const runAutomaticCloudSavePostExit = (
  objectId: string,
  shop: GameShop,
  session: CloudSaveLaunchSession
): Promise<SyncGameCloudSaveResult | null> =>
  runWithCloudSaveAccountSession(() =>
    runAutomaticCloudSavePostExitInAccount(objectId, shop, session)
  );
