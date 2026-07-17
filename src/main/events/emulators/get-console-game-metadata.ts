import type { ConsoleGameMetadata, EmulatorSystem } from "@types";
import { registerEvent } from "../register-event";
import { getConsoleGameMetadata as resolve } from "@main/services/console-metadata";
import { platformToSystem, systemFromObjectId } from "@main/helpers";
import { gamesSublevel, levelKeys } from "@main/level";

/**
 * Resolve extended IGDB metadata (scores, players, languages, series, box art)
 * for a console/emulated game by title. Console games aren't in the Hydra
 * backend, so this runs client-side (IGDB) and is cached. The objectId lets us
 * derive the console system for a precise platform-scoped IGDB query.
 */
const getConsoleGameMetadata = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  objectId: string
): Promise<ConsoleGameMetadata | null> => {
  let system = (systemFromObjectId(objectId) ?? "") as EmulatorSystem | "";
  if (!system) {
    const gameEntry = await gamesSublevel
      .get(levelKeys.game("launchbox", objectId))
      .catch(() => null);
    system = (platformToSystem(gameEntry?.platform) ?? "") as
      | EmulatorSystem
      | "";
  }
  return resolve(title, system);
};

registerEvent("getConsoleGameMetadata", getConsoleGameMetadata);
