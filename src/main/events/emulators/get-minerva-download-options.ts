import { registerEvent } from "../register-event";
import { getCatalogueEntry } from "@main/services/rom-sources/minerva-source";
import type { EmulatorSystem, GameRepack } from "@types";

const getMinervaDownloadOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  title: string
): Promise<GameRepack[]> => {
  try {
    const entry = await getCatalogueEntry(system, title);
    if (!entry) return [];

    const uri = entry.magnet ?? entry.torrentUrl;
    if (!uri) return [];

    return [
      {
        id: `minerva:${system}:${entry.filename}`,
        title: entry.title,
        fileSize: null,
        uris: [uri],
        unavailableUris: [],
        uploadDate: null,
        downloadSourceId: "minerva-archive",
        downloadSourceName: "minerva-archive.org",
        createdAt: new Date().toISOString(),
      },
    ];
  } catch (err) {
    console.error("[minerva] getMinervaDownloadOptions error:", err);
    return [];
  }
};

registerEvent("getMinervaDownloadOptions", getMinervaDownloadOptions);
