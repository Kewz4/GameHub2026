import { createHash } from "node:crypto";

import { compactGameTitle } from "../helpers/normalize-game-title";
import type { PlaynitePlaytimeCacheEntry } from "../level";
import type { GameShop } from "../../types";

export type PlaynitePlaytimeCacheRecord = readonly [
  key: string,
  entry: PlaynitePlaytimeCacheEntry,
];

export interface PlaynitePlaytimeCacheAssignment {
  selected: PlaynitePlaytimeCacheRecord;
  consumedKeys: string[];
}

export const buildUnresolvedPlaynitePlaytimeCacheKey = (
  title: string,
  sourceGameId: string
) => {
  const identity = JSON.stringify([
    compactGameTitle(title),
    sourceGameId.trim().toLowerCase(),
  ]);
  return `unresolved:${createHash("sha256").update(identity).digest("hex")}`;
};

const normalizedEntryTitle = (entry: PlaynitePlaytimeCacheEntry) =>
  entry.normalizedTitle || compactGameTitle(entry.title);

export const isPlayniteCacheEntryForGame = (
  record: PlaynitePlaytimeCacheRecord,
  game: { shop: GameShop; objectId: string; title: string }
) => {
  const [key, entry] = record;
  if (key === `${game.shop}:${game.objectId}`) return true;
  if (entry.shop === game.shop && entry.objectId === game.objectId) {
    return true;
  }
  if (game.shop === "steam" && entry.sourceGameId === game.objectId) {
    return true;
  }
  const gameTitle = compactGameTitle(game.title);
  return Boolean(gameTitle && normalizedEntryTitle(entry) === gameTitle);
};

export const selectPlayniteCacheEntryForGame = (
  records: PlaynitePlaytimeCacheRecord[],
  game: { shop: GameShop; objectId: string; title: string }
): PlaynitePlaytimeCacheRecord | null => {
  const exactKey = `${game.shop}:${game.objectId}`;
  const matches = records.filter((record) =>
    isPlayniteCacheEntryForGame(record, game)
  );
  if (matches.length === 0) return null;

  return (
    matches.find(([key]) => key === exactKey) ??
    matches.sort(
      ([, left], [, right]) =>
        right.updatedAt - left.updatedAt ||
        right.playTimeInMilliseconds - left.playTimeInMilliseconds
    )[0]
  );
};

const selectPreferredRecord = (
  records: PlaynitePlaytimeCacheRecord[],
  exactKey: string
) =>
  records.find(([key]) => key === exactKey) ??
  records
    .slice()
    .sort(
      ([, left], [, right]) =>
        right.updatedAt - left.updatedAt ||
        right.playTimeInMilliseconds - left.playTimeInMilliseconds
    )[0];

/**
 * Assign a cached Playnite row to at most one active game. Exact store/source
 * identities win; title-only fallbacks are used only when that title maps to a
 * single library game. This prevents one unresolved row from being copied into
 * duplicate/cross-store cards during library hydration.
 */
export const assignPlayniteCacheEntriesToGames = (
  records: PlaynitePlaytimeCacheRecord[],
  games: Array<{
    key: string;
    shop: GameShop;
    objectId: string;
    title: string;
  }>
) => {
  const assignments = new Map<string, PlaynitePlaytimeCacheAssignment>();
  const claimed = new Set<string>();

  for (const game of games) {
    const exact = records.filter(([key, entry]) => {
      if (claimed.has(key)) return false;
      return (
        key === game.key ||
        (entry.shop === game.shop && entry.objectId === game.objectId) ||
        (game.shop === "steam" && entry.sourceGameId === game.objectId)
      );
    });
    if (exact.length === 0) continue;
    const selected = selectPreferredRecord(exact, game.key);
    for (const [key] of exact) claimed.add(key);
    assignments.set(game.key, {
      selected,
      consumedKeys: exact.map(([key]) => key),
    });
  }

  const gamesByTitle = new Map<string, typeof games>();
  for (const game of games) {
    if (assignments.has(game.key)) continue;
    const title = compactGameTitle(game.title);
    if (!title) continue;
    gamesByTitle.set(title, [...(gamesByTitle.get(title) ?? []), game]);
  }
  for (const [title, titleGames] of gamesByTitle) {
    if (titleGames.length !== 1) continue;
    const matches = records.filter(
      ([key, entry]) =>
        !claimed.has(key) && normalizedEntryTitle(entry) === title
    );
    if (matches.length === 0) continue;
    const game = titleGames[0];
    const selected = selectPreferredRecord(matches, game.key);
    for (const [key] of matches) claimed.add(key);
    assignments.set(game.key, {
      selected,
      consumedKeys: matches.map(([key]) => key),
    });
  }

  return assignments;
};
