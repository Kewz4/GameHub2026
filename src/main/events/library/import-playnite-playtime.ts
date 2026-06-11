import fs from "node:fs";
import path from "node:path";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import {
  compactGameTitle,
  normalizeGameTitle,
} from "@main/helpers/normalize-game-title";
import type { CatalogueSearchResult } from "@types";

interface PlayniteGame {
  name: string;
  playtimeSeconds: number;
  gameId: string;
}

interface ImportResult {
  matched: number;
  total: number;
  games: Array<{ title: string; addedHours: number }>;
  unmatched: Array<{ name: string; gameId: string; playtimeHours: number }>;
}

/**
 * LiteDB v4 file parser (Playnite's games.db).
 *
 * File layout: 4096-byte pages. Page header is 25 bytes:
 *   PageID(4) PageType(1) PrevPageID(4) NextPageID(4)
 *   ItemCount(2) FreeBytes(2) Reserved(8)
 * Page types: 1=Header 2=Collection 3=Index 4=Data 5=Extend.
 *
 * Data pages contain blocks: index(2) extendPageID(4) size(2) data(size).
 * Documents larger than the block live in a chain of Extend pages
 * (extendPageID → NextPageID → …), each holding ItemCount bytes of payload.
 * The reassembled payload is a BSON document.
 */
const PAGE_SIZE = 4096;
const PAGE_HEADER_SIZE = 25;
const EMPTY_PAGE_ID = 0xffffffff;

interface PageHeader {
  pageType: number;
  nextPageId: number;
  itemCount: number;
}

function readPageHeader(data: Buffer, pageIndex: number): PageHeader | null {
  const off = pageIndex * PAGE_SIZE;
  if (off + PAGE_HEADER_SIZE > data.length) return null;
  return {
    pageType: data.readUInt8(off + 4),
    nextPageId: data.readUInt32LE(off + 9),
    itemCount: data.readUInt16LE(off + 13),
  };
}

/** Follow an extend-page chain, concatenating each page's payload. */
function readExtendChain(data: Buffer, firstPageId: number): Buffer {
  const chunks: Buffer[] = [];
  const visited = new Set<number>();
  let pageId = firstPageId;

  while (
    pageId !== EMPTY_PAGE_ID &&
    pageId * PAGE_SIZE < data.length &&
    !visited.has(pageId)
  ) {
    visited.add(pageId);
    const header = readPageHeader(data, pageId);
    if (!header || header.pageType !== 5) break;
    const start = pageId * PAGE_SIZE + PAGE_HEADER_SIZE;
    chunks.push(data.subarray(start, start + header.itemCount));
    pageId = header.nextPageId;
  }

  return Buffer.concat(chunks);
}

/** Reassemble every document stored in the file's data pages. */
function readAllDocuments(data: Buffer): Buffer[] {
  const docs: Buffer[] = [];
  const pageCount = Math.floor(data.length / PAGE_SIZE);

  for (let p = 0; p < pageCount; p++) {
    const header = readPageHeader(data, p);
    if (!header || header.pageType !== 4) continue;

    let off = p * PAGE_SIZE + PAGE_HEADER_SIZE;
    const pageEnd = (p + 1) * PAGE_SIZE;

    for (let i = 0; i < header.itemCount; i++) {
      if (off + 8 > pageEnd) break;
      const extendPageId = data.readUInt32LE(off + 2);
      const size = data.readUInt16LE(off + 6);
      off += 8;
      if (off + size > pageEnd) break;

      let doc = data.subarray(off, off + size);
      off += size;
      if (extendPageId !== EMPTY_PAGE_ID) {
        doc = Buffer.concat([doc, readExtendChain(data, extendPageId)]);
      }
      if (doc.length >= 5) docs.push(doc);
    }
  }

  return docs;
}

/**
 * Parse only the TOP-LEVEL fields of a BSON document, skipping nested
 * documents and arrays wholesale. This is critical: Playnite game documents
 * contain a Links array of {Name, Url} sub-documents, and scanning bytes for
 * "Name" markers (the previous approach) returned link labels like
 * "Official Website" instead of the game's name.
 */
function parseBsonTopLevel(doc: Buffer): Record<string, unknown> | null {
  try {
    const docLen = doc.readUInt32LE(0);
    if (docLen < 5 || docLen > doc.length) return null;

    const fields: Record<string, unknown> = {};
    let pos = 4;

    while (pos < docLen - 1) {
      const type = doc.readUInt8(pos);
      pos += 1;
      if (type === 0) break;

      const nameEnd = doc.indexOf(0, pos);
      if (nameEnd === -1 || nameEnd >= docLen) return null;
      const name = doc.toString("utf8", pos, nameEnd);
      pos = nameEnd + 1;

      switch (type) {
        case 0x01: // double
          fields[name] = doc.readDoubleLE(pos);
          pos += 8;
          break;
        case 0x02: {
          // string
          const slen = doc.readUInt32LE(pos);
          pos += 4;
          if (slen < 1 || pos + slen > docLen) return null;
          fields[name] = doc.toString("utf8", pos, pos + slen - 1);
          pos += slen;
          break;
        }
        case 0x03: // embedded document — skip entirely
        case 0x04: {
          // array — skip entirely
          const sublen = doc.readUInt32LE(pos);
          if (sublen < 5) return null;
          pos += sublen;
          break;
        }
        case 0x05: {
          // binary (GUIDs)
          const blen = doc.readUInt32LE(pos);
          pos += 4 + 1 + blen;
          break;
        }
        case 0x07: // ObjectId
          pos += 12;
          break;
        case 0x08: // bool
          fields[name] = doc.readUInt8(pos) !== 0;
          pos += 1;
          break;
        case 0x09: // datetime
          pos += 8;
          break;
        case 0x0a: // null
          fields[name] = null;
          break;
        case 0x10: // int32
          fields[name] = doc.readInt32LE(pos);
          pos += 4;
          break;
        case 0x11: // timestamp
        case 0x12: // int64
          fields[name] = Number(doc.readBigInt64LE(pos));
          pos += 8;
          break;
        case 0x13: // LiteDB decimal
          pos += 16;
          break;
        default:
          // Unknown element type — safest to discard the whole document
          return null;
      }

      if (pos > docLen) return null;
    }

    return fields;
  } catch {
    return null;
  }
}

/** Extract Playnite games (Name / Playtime / GameId) from a games.db file. */
function parsePlayniteDb(data: Buffer): PlayniteGame[] {
  const games: PlayniteGame[] = [];

  for (const doc of readAllDocuments(data)) {
    const fields = parseBsonTopLevel(doc);
    if (!fields) continue;

    const name = fields["Name"];
    if (typeof name !== "string" || name.length === 0) continue;
    // Game documents always carry Playtime; this also filters out documents
    // from any other collection that may share the file.
    if (!("Playtime" in fields) && !("GameId" in fields)) continue;

    const playtime = fields["Playtime"];
    games.push({
      name,
      playtimeSeconds: typeof playtime === "number" ? playtime : 0,
      gameId: typeof fields["GameId"] === "string" ? fields["GameId"] : "",
    });
  }

  return games;
}

/** Detect default Playnite games.db path on Windows */
function getDefaultPlaynitePath(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const defaultPath = path.join(appData, "Playnite", "library", "games.db");
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

const importPlaynitePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  dbPath?: string
): Promise<ImportResult & { detectedPath: string | null }> => {
  const detectedPath = getDefaultPlaynitePath();
  const filePath = dbPath ?? detectedPath;

  if (!filePath || !fs.existsSync(filePath)) {
    return { matched: 0, total: 0, games: [], unmatched: [], detectedPath };
  }

  let data: Buffer;
  try {
    data = fs.readFileSync(filePath);
  } catch (err) {
    logger.error("Failed to read Playnite games.db", err);
    return { matched: 0, total: 0, games: [], unmatched: [], detectedPath };
  }

  const playniteGames = parsePlayniteDb(data);

  // The same game can appear once per connected Playnite library plugin
  // (e.g. a Steam copy and an Epic copy) — keep the entry with the most
  // playtime, preferring one with a numeric (Steam) GameId on ties.
  const byTitle = new Map<string, PlayniteGame>();
  for (const g of playniteGames) {
    const key = compactGameTitle(g.name);
    if (!key) continue;
    const prev = byTitle.get(key);
    if (
      !prev ||
      g.playtimeSeconds > prev.playtimeSeconds ||
      (g.playtimeSeconds === prev.playtimeSeconds &&
        /^\d{3,10}$/.test(g.gameId) &&
        !/^\d{3,10}$/.test(prev.gameId))
    ) {
      byTitle.set(key, g);
    }
  }

  const gamesWithPlaytime = [...byTitle.values()].filter(
    (g) => g.playtimeSeconds > 0
  );

  logger.info(
    `[Playnite] Parsed ${playniteGames.length} games (${byTitle.size} unique), ${gamesWithPlaytime.length} with playtime`
  );

  // Load local library for matching
  const localGames = await gamesSublevel
    .iterator()
    .all()
    .then((entries) =>
      entries
        .filter(([, g]) => !g.isDeleted)
        .map(([key, g]) => ({ key, game: g }))
    );

  const matched: ImportResult["games"] = [];
  const unmatched: ImportResult["unmatched"] = [];

  const searchCatalogue = async (
    title: string,
    steamId?: string
  ): Promise<CatalogueSearchResult | null> => {
    try {
      const resp = await HydraApi.post<{ edges: CatalogueSearchResult[] }>(
        "/catalogue/search",
        {
          title,
          sortBy: "popularity",
          sortOrder: "desc",
          downloadSourceFingerprints: [],
          tags: [],
          publishers: [],
          genres: [],
          developers: [],
          protondbSupportBadges: [],
          deckCompatibility: [],
          take: 5,
          skip: 0,
        },
        { needsAuth: false }
      );
      const titleNorm = normalizeGameTitle(title);
      const titleCompact = compactGameTitle(title);
      return (
        resp?.edges?.find((r) => steamId && r.objectId === steamId) ??
        resp?.edges?.find((r) => normalizeGameTitle(r.title) === titleNorm) ??
        resp?.edges?.find((r) => compactGameTitle(r.title) === titleCompact) ??
        null
      );
    } catch {
      return null;
    }
  };

  for (const pg of gamesWithPlaytime) {
    const pgTitleCompact = compactGameTitle(pg.name);
    const pgPlaytimeMs = pg.playtimeSeconds * 1000;
    const steamId = /^\d{3,10}$/.test(pg.gameId) ? pg.gameId : undefined;

    // 1. Match by Steam objectId or compact title in local library
    const localById = steamId
      ? localGames.find(({ game }) => game.objectId === steamId)
      : null;
    const localMatch =
      localById ??
      localGames.find(
        ({ game }) => compactGameTitle(game.title ?? "") === pgTitleCompact
      );

    if (localMatch) {
      const existing = localMatch.game.playTimeInMilliseconds ?? 0;
      if (pgPlaytimeMs <= existing) continue;
      const addedMs = pgPlaytimeMs - existing;
      await gamesSublevel.put(localMatch.key, {
        ...localMatch.game,
        playTimeInMilliseconds: pgPlaytimeMs,
      });
      matched.push({
        title: localMatch.game.title ?? pg.name,
        addedHours: Math.round((addedMs / 3600000) * 10) / 10,
      });
      logger.info(
        `[Playnite] Updated playtime for ${localMatch.game.title}: +${(addedMs / 3600000).toFixed(1)}h`
      );
      continue;
    }

    // 2. Not in local library — search HydraAPI catalogue and add the game
    const catalogueMatch = await searchCatalogue(pg.name, steamId);
    if (!catalogueMatch) {
      unmatched.push({
        name: pg.name,
        gameId: pg.gameId,
        playtimeHours: Math.round((pgPlaytimeMs / 3600000) * 10) / 10,
      });
      continue;
    }

    const gameKey = levelKeys.game(catalogueMatch.shop, catalogueMatch.objectId);
    const existingGame = await gamesSublevel.get(gameKey).catch(() => null);

    if (!existingGame || existingGame.isDeleted) {
      await gamesSublevel.put(gameKey, {
        title: catalogueMatch.title,
        objectId: catalogueMatch.objectId,
        shop: catalogueMatch.shop,
        iconUrl: catalogueMatch.libraryImageUrl ?? null,
        libraryHeroImageUrl: null,
        logoImageUrl: null,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: pgPlaytimeMs,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        automaticCloudSync: false,
        // Games matched by Steam App ID are confirmed as owned on Steam;
        // title-only matches are unverified so keep them as catalog.
        libraryOrigin: (steamId && catalogueMatch.objectId === steamId)
          ? ("sync" as const)
          : ("catalog" as const),
      });
      matched.push({
        title: catalogueMatch.title,
        addedHours: Math.round((pgPlaytimeMs / 3600000) * 10) / 10,
      });
      logger.info(
        `[Playnite] Added ${catalogueMatch.title} to library with ${(pgPlaytimeMs / 3600000).toFixed(1)}h playtime`
      );
    } else if (pgPlaytimeMs > (existingGame.playTimeInMilliseconds ?? 0)) {
      const addedMs = pgPlaytimeMs - (existingGame.playTimeInMilliseconds ?? 0);
      await gamesSublevel.put(gameKey, {
        ...existingGame,
        playTimeInMilliseconds: pgPlaytimeMs,
      });
      matched.push({
        title: catalogueMatch.title,
        addedHours: Math.round((addedMs / 3600000) * 10) / 10,
      });
      logger.info(
        `[Playnite] Updated playtime for ${catalogueMatch.title}: +${(addedMs / 3600000).toFixed(1)}h`
      );
    }
  }

  return {
    matched: matched.length,
    total: gamesWithPlaytime.length,
    games: matched,
    unmatched,
    detectedPath,
  };
};

registerEvent("importPlaynitePlaytime", importPlaynitePlaytime);
