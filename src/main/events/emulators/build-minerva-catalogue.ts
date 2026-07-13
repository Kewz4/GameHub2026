import { registerEvent } from "../register-event";
import { syncAllDumpSources } from "@main/services/rom-sources/gamehub-dump-sources";
import type { EmulatorSystem } from "@types";

/**
 * Rebuild the console catalogue from the bundled GameHub Vault dumps (games +
 * updates + DLC, direct hoster links). Wired to the "rebuild catalogue" action.
 */
registerEvent(
  "buildMinervaCatalogue",
  async (): Promise<Partial<Record<EmulatorSystem, number>> | number> => {
    const result = await syncAllDumpSources();
    return result as Partial<Record<EmulatorSystem, number>>;
  }
);
