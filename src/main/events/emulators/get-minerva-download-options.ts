import { registerEvent } from "../register-event";
import { getCatalogueEntry } from "@main/services/rom-sources/minerva-source";
import type { MinervaCatalogueEntry } from "@main/level/sublevels/minerva-catalogue";
import type { EmulatorSystem, GameRepack } from "@types";

function buildRepackTitle(entry: MinervaCatalogueEntry): string {
  if (entry.contentType === "update") {
    const m =
      entry.filename.match(/[Uu]pdate\s+(v[\d.]+)/i) ??
      entry.filename.match(/(v[\d.]+)/i);
    const ver = m?.[1] ?? "";
    return ver ? `Update ${ver.startsWith("v") ? ver : "v" + ver}` : "Update";
  }
  if (entry.contentType === "dlc") {
    const stem = entry.filename.replace(/\.[a-z0-9]{1,5}$/i, "");
    const m = stem.match(/[-–]\s*(.+?)\s*(?:\(\w+\))?$/);
    if (m) {
      const candidate = m[1].trim();
      if (candidate.length > 4 && !/^\w{2,4}$/.test(candidate)) {
        return candidate;
      }
    }
    return "DLC";
  }
  return entry.title;
}

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
        title: buildRepackTitle(entry),
        fileSize: entry.fileSize ?? null,
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
