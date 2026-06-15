import { registerEvent } from "../register-event";
import {
  openExophaseLoginWindow,
  type ExophaseAuthState,
} from "@main/services/achievements/exophase";

const openExophaseAuthWindow = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophaseAuthState> => openExophaseLoginWindow();

registerEvent("openExophaseAuthWindow", openExophaseAuthWindow);
