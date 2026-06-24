import { registerEvent } from "../register-event";
import { searchMinervaCatalogue } from "@main/level/sublevels/minerva-catalogue";
import { normalizeTitle } from "@main/services/rom-sources/minerva-source";
import type { EmulatorSystem, GameRepack } from "@types";

registerEvent(
  "searchMinervaCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    title: string,
    system?: EmulatorSystem
  ): Promise<GameRepack[]> => {
    const entries = await searchMinervaCatalogue(title, system);
    return entries.map((entry) => ({
      id: `minerva-${entry.system}-${normalizeTitle(entry.title)}`,
      title: entry.title,
      uris: entry.magnet ? [entry.magnet] : [],
      fileSize: entry.fileSize ?? null,
      uploadDate: null,
      downloadSourceId: "minerva",
      downloadSourceName: "Minerva Archive",
      unavailableUris: [],
      createdAt: new Date().toISOString(),
    }));
  }
);
