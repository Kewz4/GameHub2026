import fs from "node:fs";
import path from "node:path";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";

interface PlayniteGame {
  name: string;
  playtimeSeconds: number;
  gameId: string;
}

interface ImportResult {
  matched: number;
  total: number;
  games: Array<{ title: string; addedHours: number }>;
}

/** Read a little-endian int32 safely */
function readInt32LE(buf: Buffer, offset: number): number | null {
  if (offset + 4 > buf.length) return null;
  return buf.readInt32LE(offset);
}

/** Read a little-endian int64 as number (safe for playtime values) */
function readInt64LE(buf: Buffer, offset: number): number | null {
  if (offset + 8 > buf.length) return null;
  return Number(buf.readBigInt64LE(offset));
}

/**
 * Minimal LiteDB v4 binary parser — extracts Name, Playtime, GameId fields
 * from BSON documents stored in the LiteDB pages.
 * LiteDB page size is 4096 bytes; the first page is a header.
 */
function parseLiteDB(data: Buffer): PlayniteGame[] {
  const PAGE_SIZE = 4096;
  const games: PlayniteGame[] = [];

  const findStringField = (chunk: Buffer, key: string): string | null => {
    const marker = Buffer.from(`\x02${key}\x00`);
    const idx = chunk.indexOf(marker);
    if (idx === -1) return null;
    const p = idx + marker.length;
    const slen = readInt32LE(chunk, p);
    if (slen === null || slen <= 0 || slen > 2000) return null;
    try {
      return chunk.slice(p + 4, p + 4 + slen - 1).toString("utf8");
    } catch {
      return null;
    }
  };

  const findInt64Field = (chunk: Buffer, key: string): number | null => {
    const marker = Buffer.from(`\x12${key}\x00`);
    const idx = chunk.indexOf(marker);
    if (idx === -1) return null;
    return readInt64LE(chunk, idx + marker.length);
  };

  let pos = PAGE_SIZE;
  while (pos < data.length - 4) {
    const docLen = readInt32LE(data, pos);
    if (docLen !== null && docLen > 80 && docLen < 30000) {
      const chunk = data.slice(pos, pos + docLen);
      const name = findStringField(chunk, "Name");
      const playtime = findInt64Field(chunk, "Playtime");
      const gameId = findStringField(chunk, "GameId");

      if (
        name &&
        playtime !== null &&
        name.length > 1 &&
        // Filter out Playnite UI link records (short single-word labels)
        name.includes(" ") || (name.length > 8 && /[a-zA-Z0-9]/.test(name[0]))
      ) {
        games.push({
          name,
          playtimeSeconds: playtime,
          gameId: gameId ?? "",
        });
        pos += docLen;
        continue;
      }
    }
    pos++;
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
    return { matched: 0, total: 0, games: [], detectedPath };
  }

  let data: Buffer;
  try {
    data = fs.readFileSync(filePath);
  } catch (err) {
    logger.error("Failed to read Playnite games.db", err);
    return { matched: 0, total: 0, games: [], detectedPath };
  }

  const playniteGames = parseLiteDB(data);
  const gamesWithPlaytime = playniteGames.filter((g) => g.playtimeSeconds > 0);

  logger.info(
    `[Playnite] Found ${playniteGames.length} games, ${gamesWithPlaytime.length} with playtime`
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

  for (const pg of gamesWithPlaytime) {
    const pgTitleNorm = normalizeGameTitle(pg.name);
    const pgPlaytimeMs = pg.playtimeSeconds * 1000;

    // Match by Steam objectId (numeric gameId)
    const byId =
      /^\d{5,10}$/.test(pg.gameId)
        ? localGames.find(({ game }) => game.objectId === pg.gameId)
        : null;

    // Match by normalized title
    const byTitle =
      byId ??
      localGames.find(
        ({ game }) => normalizeGameTitle(game.title ?? "") === pgTitleNorm
      );

    const match = byId ?? byTitle;
    if (!match) continue;

    const existing = match.game.playTimeInMilliseconds ?? 0;
    if (pgPlaytimeMs <= existing) continue; // don't reduce playtime

    const addedMs = pgPlaytimeMs - existing;
    await gamesSublevel.put(match.key, {
      ...match.game,
      playTimeInMilliseconds: pgPlaytimeMs,
    });

    matched.push({
      title: match.game.title,
      addedHours: Math.round(addedMs / 3600000 * 10) / 10,
    });

    logger.info(
      `[Playnite] Updated playtime for ${match.game.title}: +${(addedMs / 3600000).toFixed(1)}h`
    );
  }

  return {
    matched: matched.length,
    total: gamesWithPlaytime.length,
    games: matched,
    detectedPath,
  };
};

registerEvent("importPlaynitePlaytime", importPlaynitePlaytime);
