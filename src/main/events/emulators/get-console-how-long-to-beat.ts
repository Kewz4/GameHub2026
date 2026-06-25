import type { HowLongToBeatCategory } from "@types";
import { registerEvent } from "../register-event";
import { getConsoleHowLongToBeat as resolve } from "@main/services/how-long-to-beat";

/**
 * Resolve HowLongToBeat times for a console/emulated game by title (cached).
 * Console games aren't in the Hydra backend, so this runs HLTB client-side.
 */
const getConsoleHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string
): Promise<HowLongToBeatCategory[] | null> => resolve(title);

registerEvent("getConsoleHowLongToBeat", getConsoleHowLongToBeat);
