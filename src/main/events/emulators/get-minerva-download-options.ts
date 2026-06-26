import { registerEvent } from "../register-event";
import {
  minervaCatalogueSublevel,
  type MinervaCatalogueEntry,
} from "@main/level/sublevels/minerva-catalogue";
import { normalizeTitle } from "@main/services/rom-sources/minerva-source";
import type { EmulatorSystem, GameRepack } from "@types";

function extractRegion(filename: string): string {
  const m = filename.match(/\((USA|Europe|Japan|World|JPN|EUR)\)/i);
  return m ? m[1] : "";
}

function buildRepackTitle(entry: MinervaCatalogueEntry): string {
  const region = extractRegion(entry.filename);
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
    const stem = entry.filename.replace(/\.[a-z0-9]{1,5}$/i, "");
    const m = stem.match(/[-–]\s*(.+?)\s*(?:\(\w+\))?$/);
    if (m) {
      const candidate = m[1].trim();
      if (candidate.length > 4 && !/^\w{2,4}$/.test(candidate)) {
        return `${candidate}${regionSuffix}`;
      }
    }
    return `DLC${regionSuffix}`;
  }
  // base game — append region so regional variants are distinguishable
  return `${entry.title}${regionSuffix}`;
}

async function scanAllVariants(
  system: EmulatorSystem,
  normalizedTitle: string
): Promise<MinervaCatalogueEntry[]> {
  const entries: MinervaCatalogueEntry[] = [];
  const prefixes = [`${system}:`, `${system}-upd:`, `${system}-dlc:`];

  for (const prefix of prefixes) {
    const gte = `${prefix}${normalizedTitle}`;
    const lte = `${prefix}${normalizedTitle}\xFF`;
    for await (const [, record] of minervaCatalogueSublevel.iterator({
      gte,
      lte,
    })) {
      entries.push(record.entry);
    }
  }

  return entries;
}

const getMinervaDownloadOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  title: string
): Promise<GameRepack[]> => {
  try {
    const norm = normalizeTitle(title);
    const entries = await scanAllVariants(system, norm);

    if (entries.length === 0) return [];

    const repacks: GameRepack[] = [];
    for (const entry of entries) {
      const uri = entry.magnet ?? entry.torrentUrl;
      if (!uri) continue;

      repacks.push({
        id: `minerva:${system}:${entry.filename}`,
        title: buildRepackTitle(entry),
        fileSize: entry.fileSize ?? null,
        uris: [uri],
        unavailableUris: [],
        uploadDate: null,
        downloadSourceId: "minerva-archive",
        downloadSourceName: "Minerva Archive",
        createdAt: new Date().toISOString(),
        contentType: entry.contentType ?? "game",
      });
    }

    // Sort: base games first, then updates, then DLC
    const order = { game: 0, update: 1, dlc: 2 };
    repacks.sort(
      (a, b) =>
        (order[a.contentType ?? "game"] ?? 0) -
        (order[b.contentType ?? "game"] ?? 0)
    );

    return repacks;
  } catch (err) {
    console.error("[minerva] getMinervaDownloadOptions error:", err);
    return [];
  }
};

registerEvent("getMinervaDownloadOptions", getMinervaDownloadOptions);
