import { registerEvent } from "../register-event";
import {
  buildSystemCatalogue,
  buildFullCatalogue,
} from "@main/services/rom-sources/minerva-source";
import type { EmulatorSystem } from "@types";

registerEvent(
  "buildMinervaCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    system?: EmulatorSystem
  ): Promise<Partial<Record<EmulatorSystem, number>> | number> => {
    if (system) return buildSystemCatalogue(system);
    return buildFullCatalogue();
  }
);
