import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { ExophaseSyncReport } from "@types";

const getExophaseSyncReport = (
  _event: Electron.IpcMainInvokeEvent
): Promise<ExophaseSyncReport | null> =>
  db
    .get<string, ExophaseSyncReport | null>(levelKeys.exophaseSyncReport, {
      valueEncoding: "json",
    })
    .catch(() => null);

registerEvent("getExophaseSyncReport", getExophaseSyncReport);
