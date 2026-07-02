import { registerEvent } from "../register-event";
import {
  searchMinervaCatalogue,
  type MinervaCatalogueEntry,
} from "@main/level/sublevels/minerva-catalogue";
import {
  parseRomFilename,
  isAllowedRomRegion,
} from "@main/services/emulators/parse-rom-filename";
import { dedupeRegionalVariants } from "./get-minerva-download-options";
import type { EmulatorSystem, GameRepack } from "@types";

/** Build a descriptive, region-tagged repack title: for updates extract the
 *  version string, for DLC the DLC name, for base games the parsed title.
 *  Kept identical in shape to getMinervaDownloadOptions so the two handlers
 *  never produce divergent titles for the same id. */
function buildRepackTitle(entry: MinervaCatalogueEntry): string {
  const region = parseRomFilename(entry.filename).region;
  const regionSuffix = region ? ` (${region})` : "";

  if (entry.contentType === "update") {
    const m =
      entry.filename.match(/[Uu]pdate\s+(v[\d.]+)/i) ??
      entry.filename.match(/(v[\d.]+)/i);
    const ver = m?.[1] ?? "";
    return ver
      ? `Update ${ver.startsWith("v") ? ver : "v" + ver}${regionSuffix}`
      : `Update${regionSuffix}`;
  }
  if (entry.contentType === "dlc") {
    // Strip the extension and EVERY trailing parenthetical tag ("(USA) (DLC)")
    // so a tag never leaks into the DLC name (which then had the region
    // appended twice: "Breath of the Wild (Europe) (Europe)").
    let stem = entry.filename.replace(/\.[a-z0-9]{1,5}$/i, "");
    while (/\s*\([^()]*\)\s*$/.test(stem)) {
      stem = stem.replace(/\s*\([^()]*\)\s*$/, "");
    }
    const m = stem.match(/[-–]\s*([^-–]+?)\s*$/);
    if (m) {
      const candidate = m[1].trim();
      // A real DLC name, not just the tail of the game's own title.
      const isGameTitleTail = entry.title
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .endsWith(candidate.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (
        candidate.length > 4 &&
        !/^\w{2,4}$/.test(candidate) &&
        !isGameTitleTail
      ) {
        return `${candidate}${regionSuffix}`;
      }
    }
    return `DLC${regionSuffix}`;
  }
  return `${entry.title}${regionSuffix}`;
}

registerEvent(
  "searchMinervaCatalogue",
  async (
    _event: Electron.IpcMainInvokeEvent,
    title: string,
    system?: EmulatorSystem
  ): Promise<GameRepack[]> => {
    const entries = await searchMinervaCatalogue(title, system);
    // One download per region (highest revision), USA/Europe only.
    return dedupeRegionalVariants(
      entries.filter((entry) => isAllowedRomRegion(entry.filename))
    ).map((entry) => ({
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
      region: entry.region ?? parseRomFilename(entry.filename).region,
      emulatorSystem: entry.system,
      fileName: entry.filename,
    }));
  }
);
