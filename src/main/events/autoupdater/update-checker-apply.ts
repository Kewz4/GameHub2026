import { registerEvent } from "../register-event";
import { UpdateCheckerManager } from "@main/services/update-checker-manager";

const updateCheckerApply = async (_event: Electron.IpcMainInvokeEvent) => {
  if (UpdateCheckerManager.isPortable && process.platform === "win32") {
    await UpdateCheckerManager.applyPortableUpdate();
  } else {
    await UpdateCheckerManager.applyNsisUpdate();
  }
};

registerEvent("updateCheckerApply", updateCheckerApply);
