import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "@main/services";
import { retryPendingCloudSavePostExitOnNetworkReconnect } from "@main/services/cloud-save/pending-post-exit";

const updateNetworkStatus = (
  _event: Electron.IpcMainInvokeEvent,
  payload: {
    online: boolean;
    switched?: boolean;
    forceReconnect?: boolean;
  }
) => {
  DownloadOrchestrator.onNetworkStatusChanged(payload);
  retryPendingCloudSavePostExitOnNetworkReconnect(
    payload.online,
    payload.switched
  );
};

registerEvent("updateNetworkStatus", updateNetworkStatus);
