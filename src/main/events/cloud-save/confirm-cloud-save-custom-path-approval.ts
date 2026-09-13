import {
  confirmPendingCloudSaveCustomPathApproval,
  getPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";
import type { ConfirmCloudSaveCustomPathApprovalResult } from "@types";

import { registerEvent } from "../register-event";
import { openGame } from "../library/open-game";

registerEvent(
  "confirmCloudSaveCustomPathApproval",
  async (
    _event: Electron.IpcMainInvokeEvent,
    approvalId: string
  ): Promise<ConfirmCloudSaveCustomPathApprovalResult> => {
    const launchOptions =
      await confirmPendingCloudSaveCustomPathApproval(approvalId);

    // Re-enter the normal launch event after binding so URI/Legendary games,
    // legacy mode, V2 pre-launch restore, and the upload guard all follow the
    // same path as the user's original launch.
    await openGame(
      _event,
      launchOptions.shop,
      launchOptions.objectId,
      launchOptions.executablePath,
      launchOptions.launchOptions
    );

    return {
      pendingApproval: getPendingCloudSaveCustomPathApproval(
        launchOptions.shop,
        launchOptions.objectId
      ),
    };
  }
);
