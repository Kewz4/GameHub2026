import type { HowLongToBeatCategory, EmulatorSystem } from "@types";
import { registerEvent } from "../register-event";
import { getConsoleHowLongToBeat as resolve } from "@main/services/how-long-to-beat";

/**
 * Resolve HowLongToBeat times for a console/emulated game by title (cached).
 * Console games aren't in the Hydra backend, so this runs HLTB client-side.
 * `system` (when the caller can derive it) scopes the dataset-first lookup.
 */
const getConsoleHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  system?: EmulatorSystem | ""
): Promise<HowLongToBeatCategory[] | null> => resolve(title, system);

registerEvent("getConsoleHowLongToBeat", getConsoleHowLongToBeat);
