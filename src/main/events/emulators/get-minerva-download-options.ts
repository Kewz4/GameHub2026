import { registerEvent } from "../register-event";
import {
  minervaCatalogueSublevel,
  type MinervaCatalogueEntry,
} from "@main/level/sublevels/minerva-catalogue";
import {
  normalizeRomTitle as normalizeTitle,
  parseRomFilename,
  romRegionFamilies,
} from "@main/services/emulators/parse-rom-filename";
import type { EmulatorSystem, GameRepack } from "@types";
import { logger } from "@main/services";

function buildRepackTitle(entry: MinervaCatalogueEntry): string {
  const region = parseRomFilename(entry.filename).region;
  const regionSuffix = region ? ` (${region})` : "";

  if (entry.contentType === "update") {
    const m =
      entry.filename.match(/[Uu]pdate\s+v?([\d.]+)/i) ??
      entry.filename.match(/\bv([\d.]+)/i);
    // The capture is the bare number (no "v"): a case-insensitive match on a
    // "(V1.0)" tag used to leave the captured "V" in place and then prepend
    // another "v" ("Update vV1.0" → read as "vv1.0"). Capturing digits-only and
    // always prefixing a single lowercase "v" makes the label case-proof.
    const ver = m?.[1] ?? "";
    return ver ? `Update v${ver}${regionSuffix}` : `Update${regionSuffix}`;
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
  // base game — append region so regional variants are distinguishable
  return `${entry.title}${regionSuffix}`;
}

/** Revision ordinal from a No-Intro filename: "(Rev 1)" → 1, "(Rev A)" → 1,
 *  "(Rev B)" → 2, no tag → 0. Higher revisions are bugfix reissues. */
export function revisionOf(filename: string): number {
  const m = filename.match(/\(rev\s*([0-9]+|[a-z])\)/i);
  if (!m) return 0;
  const raw = m[1].toLowerCase();
  return /^[0-9]+$/.test(raw)
    ? parseInt(raw, 10)
    : raw.charCodeAt(0) - "a".charCodeAt(0) + 1;
}

/**
 * Collapse base-game entries to ONE download per game+region family,
 * preferring the highest revision (tie-break: longest filename — usually the
 * fuller language set). A multi-region file ("(USA, Europe)") competes in
 * every region it covers, so it supersedes single-country variants (e.g. a
 * "(Germany)" cart) instead of leaving them as duplicate options.
 * Updates/DLC are distinct content and pass through.
 */
export function dedupeRegionalVariants(
  entries: MinervaCatalogueEntry[]
): MinervaCatalogueEntry[] {
  const best = new Map<string, MinervaCatalogueEntry>();
  const rest: MinervaCatalogueEntry[] = [];

  const beats = (a: MinervaCatalogueEntry, b: MinervaCatalogueEntry) =>
    revisionOf(a.filename) > revisionOf(b.filename) ||
    (revisionOf(a.filename) === revisionOf(b.filename) &&
      a.filename.length > b.filename.length);

  for (const entry of entries) {
    if ((entry.contentType ?? "game") !== "game") {
      rest.push(entry);
      continue;
    }
    const families = romRegionFamilies(entry.filename);
    const groups = families.length > 0 ? families : ["unknown"];
    for (const family of groups) {
      const key = `${entry.system}:${normalizeTitle(entry.title)}:${family}`;
      const current = best.get(key);
      if (!current || beats(entry, current)) {
        best.set(key, entry);
      }
    }
  }

  // A winner of several region groups appears once.
  const seen = new Set<string>();
  const winners: MinervaCatalogueEntry[] = [];
  for (const entry of best.values()) {
    const id = `${entry.system}:${entry.filename}`;
    if (seen.has(id)) continue;
    seen.add(id);
    winners.push(entry);
  }

  return [...winners, ...rest];
}

async function scanAllVariants(
  system: EmulatorSystem,
  normalizedTitle: string
): Promise<MinervaCatalogueEntry[]> {
  const entries: MinervaCatalogueEntry[] = [];
  const prefixes = [`${system}:`, `${system}-upd:`, `${system}-dlc:`];

  for (const prefix of prefixes) {
    // Keys are `${prefix}${normalizedTitle}:${normalizedFilenameStem}`. The
    // trailing colon delimiter is REQUIRED: scanning `${prefix}${title}` without
    // it matches every title that merely STARTS with this string — e.g. title
    // "N+" normalizes to "n" and bled into 305 unrelated "n…" games.
    const gte = `${prefix}${normalizedTitle}:`;
    const lte = `${prefix}${normalizedTitle}:\xFF`;
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
    // One download per region: highest revision wins over the base release.
    const entries = dedupeRegionalVariants(await scanAllVariants(system, norm));

    if (entries.length === 0) return [];

    const repacks: GameRepack[] = [];
    for (const entry of entries) {
      // GameHub Vault dumps are a direct hoster link (VikingFile etc.) routed
      // through TorBox/the hoster — no torrent. Legacy Minerva magnets/.torrent
      // are still honoured as a fallback.
      const torrentUrl = entry.torrentUrl
        ? entry.torrentUrl.startsWith("/")
          ? `https://minerva-archive.org${entry.torrentUrl}`
          : entry.torrentUrl
        : null;
      const uri = entry.downloadUrl ?? torrentUrl ?? entry.magnet;
      if (!uri) continue;

      repacks.push({
        id: `minerva:${system}:${entry.filename}`,
        title: buildRepackTitle(entry),
        fileSize: entry.fileSize ?? null,
        uris: [uri],
        unavailableUris: [],
        uploadDate: null,
        downloadSourceId: "gamehub-vault",
        downloadSourceName: "GameHub Vault",
        createdAt: new Date().toISOString(),
        contentType: entry.contentType ?? "game",
        region: entry.region ?? parseRomFilename(entry.filename).region,
        emulatorSystem: system,
        fileName: entry.filename,
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
    logger.error("[minerva] getMinervaDownloadOptions error:", err);
    return [];
  }
};

registerEvent("getMinervaDownloadOptions", getMinervaDownloadOptions);
