import { registerEvent } from "../register-event";
import {
  searchMinervaCatalogue,
  type MinervaCatalogueEntry,
} from "@main/level/sublevels/minerva-catalogue";
import type { EmulatorSystem, GameRepack } from "@types";

/** Build a descriptive repack title: for updates extract the version string,
 *  for DLC extract the DLC name, for base games use the parsed game title. */
function buildRepackTitle(entry: MinervaCatalogueEntry): string {
  if (entry.contentType === "update") {
    // e.g. "Game Title - Update v208 (USA).wux"  →  "Update v208"
    const m =
      entry.filename.match(/[Uu]pdate\s+(v[\d.]+)/i) ??
      entry.filename.match(/(v[\d.]+)/i);
    const ver = m?.[1] ?? "";
    return ver ? `Update ${ver.startsWith("v") ? ver : "v" + ver}` : "Update";
  }
  if (entry.contentType === "dlc") {
    // e.g. "Game Title - DLC Pack 2 - Master Sword Trials (USA).wux"
    //      → "DLC Pack 2 - Master Sword Trials"
    const stem = entry.filename.replace(/\.[a-z0-9]{1,5}$/i, ""); // strip ext
    const m = stem.match(/[-–]\s*(.+?)\s*(?:\(\w+\))?$/);
    if (m) {
      const candidate = m[1].trim();
      // Only use if it looks like a DLC label (not a bare region like "USA")
      if (candidate.length > 4 && !/^\w{2,4}$/.test(candidate)) {
        return candidate;
      }
    }
    return "DLC";
  }
  return entry.title;
}

registerEvent(
  "searchMinervaCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    title: string,
    system?: EmulatorSystem
  ): Promise<GameRepack[]> => {
    const entries = await searchMinervaCatalogue(title, system);
    return entries.map((entry) => ({
      id: `minerva:${entry.system}:${entry.filename}`,
      title: buildRepackTitle(entry),
      uris: entry.magnet ? [entry.magnet] : [],
      fileSize: entry.fileSize ?? null,
      uploadDate: null,
      downloadSourceId: "minerva",
      downloadSourceName: "Minerva Archive",
      unavailableUris: [],
      createdAt: new Date().toISOString(),
      contentType: entry.contentType ?? "game",
    }));
  }
);
