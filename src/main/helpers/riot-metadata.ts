import type { ShopAssets, ShopDetailsWithAssets } from "@types";

/**
 * Curated metadata for Riot titles. The Hydra catalogue has thin/empty
 * entries for these (e.g. League of Legends resolves to a record with no
 * description, genres, requirements or rating), which left the game-details
 * page blank. Riot games are a small fixed set, so we bake in proper text
 * metadata here and pair it with SteamGridDB artwork captured at sync time —
 * giving the page the same fields a normal Hydra/Steam game provides without
 * relying on the broken catalogue entry.
 */
interface RiotMeta {
  name: string;
  shortDescription: string;
  description: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  releaseDate: string;
  minimum: string;
  recommended: string;
}

const RIOT_METADATA: Record<string, RiotMeta> = {
  league_of_legends: {
    name: "League of Legends",
    shortDescription:
      "A fast-paced, competitive 5v5 MOBA where two teams of champions battle to destroy the enemy Nexus.",
    description:
      "League of Legends is a team-based strategy game where two teams of five powerful champions face off to destroy the other's base. Choose from over 160 champions to make epic plays, secure kills, and take down towers as you battle your way to victory across maps such as Summoner's Rift and ARAM's Howling Abyss.",
    developers: ["Riot Games"],
    publishers: ["Riot Games"],
    genres: ["MOBA", "Strategy", "Free to Play"],
    releaseDate: "27 Oct, 2009",
    minimum:
      "OS: Windows 7 or later | CPU: 3 GHz processor | RAM: 2 GB | GPU: Shader version 2.0 capable | Storage: 16 GB",
    recommended:
      "OS: Windows 10 | CPU: 3 GHz dual-core | RAM: 4 GB | GPU: GeForce 8800 / Radeon HD 5670 | Storage: 16 GB SSD",
  },
  valorant: {
    name: "VALORANT",
    shortDescription:
      "A 5v5 character-based tactical shooter where precise gunplay meets unique agent abilities.",
    description:
      "VALORANT is a 5v5 character-based tactical FPS where precise gunplay meets unique agent abilities. Blend your style and experience as you outwit, outplay, and outshoot the competition with a roster of agents drawn from countries and cultures around the world.",
    developers: ["Riot Games"],
    publishers: ["Riot Games"],
    genres: ["Tactical Shooter", "FPS", "Free to Play"],
    releaseDate: "2 Jun, 2020",
    minimum:
      "OS: Windows 10 | CPU: Intel Core 2 Duo E8400 | RAM: 4 GB | GPU: Intel HD 4000 | Storage: 30 GB",
    recommended:
      "OS: Windows 10 | CPU: Intel i3-4150 | RAM: 4 GB | GPU: GeForce GT 730 | Storage: 30 GB SSD",
  },
  bacon: {
    name: "Legends of Runeterra",
    shortDescription:
      "A strategy card game set in the world of Runeterra where skill, creativity, and cleverness decide the duel.",
    description:
      "Legends of Runeterra is the strategy card game where skill, creativity, and cleverness determine your success. Combine and build decks featuring your favourite champions and allies across the regions of Runeterra to outplay your opponents with clever combinations.",
    developers: ["Riot Games"],
    publishers: ["Riot Games"],
    genres: ["Card Game", "Strategy", "Free to Play"],
    releaseDate: "29 Apr, 2020",
    minimum:
      "OS: Windows 7 or later | CPU: 2 GHz processor | RAM: 2 GB | GPU: Shader version 2.0 capable | Storage: 4 GB",
    recommended:
      "OS: Windows 10 | CPU: 3 GHz processor | RAM: 4 GB | GPU: Dedicated GPU | Storage: 4 GB",
  },
};

export const isCuratedRiotGame = (objectId: string): boolean =>
  objectId in RIOT_METADATA;

/**
 * Build a full ShopDetailsWithAssets for a curated Riot game. `assets` should
 * be the SteamGridDB-sourced artwork persisted at library sync time; its
 * title/images flow through to the page so cover art and hero render.
 */
export const buildRiotShopDetails = (
  objectId: string,
  assets: ShopAssets | null,
  fallbackTitle?: string | null
): ShopDetailsWithAssets | null => {
  const meta = RIOT_METADATA[objectId];
  if (!meta) return null;

  const reqs = {
    minimum: meta.minimum,
    recommended: meta.recommended,
  };

  return {
    objectId,
    name: assets?.title ?? fallbackTitle ?? meta.name,
    steam_appid: 0,
    detailed_description: meta.description,
    about_the_game: meta.description,
    short_description: meta.shortDescription,
    developers: meta.developers,
    publishers: meta.publishers,
    genres: meta.genres.map((g, i) => ({ id: String(i + 1), name: g })),
    supported_languages: "English",
    screenshots: [],
    movies: [],
    pc_requirements: reqs,
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: { coming_soon: false, date: meta.releaseDate },
    content_descriptors: { ids: [] },
    assets,
  } as ShopDetailsWithAssets;
};
