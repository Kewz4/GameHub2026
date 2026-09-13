import { playnitePlaytimeCacheSublevel } from "../level";
import type { GameShop } from "../../types";
import {
  isPlayniteCacheEntryForGame,
  selectPlayniteCacheEntryForGame,
  type PlaynitePlaytimeCacheRecord,
} from "./playnite-playtime-cache-policy";

export {
  assignPlayniteCacheEntriesToGames,
  buildUnresolvedPlaynitePlaytimeCacheKey,
  isPlayniteCacheEntryForGame,
  selectPlayniteCacheEntryForGame,
  type PlaynitePlaytimeCacheRecord,
} from "./playnite-playtime-cache-policy";

export const findPlayniteCacheEntryForGame = async (game: {
  shop: GameShop;
  objectId: string;
  title: string;
}) => {
  const records = (await playnitePlaytimeCacheSublevel
    .iterator()
    .all()) as PlaynitePlaytimeCacheRecord[];
  return selectPlayniteCacheEntryForGame(records, game);
};

export const removePlayniteCacheEntriesForGame = async (game: {
  shop: GameShop;
  objectId: string;
  title: string;
}) => {
  const records = (await playnitePlaytimeCacheSublevel
    .iterator()
    .all()) as PlaynitePlaytimeCacheRecord[];
  const matches = records.filter((record) =>
    isPlayniteCacheEntryForGame(record, game)
  );
  await Promise.all(
    matches.map(([key]) => playnitePlaytimeCacheSublevel.del(key))
  );
  return matches.length;
};
