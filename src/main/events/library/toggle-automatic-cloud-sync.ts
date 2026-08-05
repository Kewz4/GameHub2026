import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { setLegacyCloudSaveAutomaticSyncEnabled } from "@main/services/cloud-save/automatic-sync-settings";

const toggleAutomaticCloudSync = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  automaticCloudSync: boolean
) => {
  await setLegacyCloudSaveAutomaticSyncEnabled(
    objectId,
    shop,
    automaticCloudSync
  );
};

registerEvent("toggleAutomaticCloudSync", toggleAutomaticCloudSync);
