import { registerEvent } from "../register-event";
import { clearExophaseSession as clearSession } from "@main/services/achievements/exophase";

const clearExophaseSession = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ ok: boolean }> => {
  await clearSession();
  return { ok: true };
};

registerEvent("clearExophaseSession", clearExophaseSession);
