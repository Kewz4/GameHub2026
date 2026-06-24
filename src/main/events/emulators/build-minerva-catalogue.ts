import { registerEvent } from "../register-event";
import {
  syncMinervaSource,
  syncAllMinervaSources,
} from "@main/services/rom-sources/minerva-sources";
import type { EmulatorSystem } from "@types";

/**
 * Populate the local Minerva catalogue from the hosted per-platform source
 * files on GitHub (fast: a single JSON fetch per system, magnets included).
 */
registerEvent(
  "buildMinervaCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    system?: EmulatorSystem
  ): Promise<Partial<Record<EmulatorSystem, number>> | number> => {
    if (system) return syncMinervaSource(system);
    return syncAllMinervaSources();
  }
);
