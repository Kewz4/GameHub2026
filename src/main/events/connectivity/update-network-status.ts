import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "@main/services";

const updateNetworkStatus = (
  _event: Electron.IpcMainInvokeEvent,
  payload: {
    online: boolean;
    switched?: boolean;
    forceReconnect?: boolean;
  }
) => {
  DownloadOrchestrator.onNetworkStatusChanged(payload);
};

registerEvent("updateNetworkStatus", updateNetworkStatus);
